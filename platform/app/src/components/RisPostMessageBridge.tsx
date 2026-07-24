import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppConfig } from '@state';

const MESSAGE_SOURCE_RIS = 'DICOMRIS';
const MESSAGE_SOURCE_VIEWER = 'DICOMRIS_VIEWER';
const LOAD_STUDY = 'LOAD_STUDY';
const AUTH_SESSION = 'AUTH_SESSION';
const VIEWER_READY = 'VIEWER_READY';

type RisPostMessageConfig = {
  enabled?: boolean;
  allowedOrigins?: string[];
};

function normalizeStudyInstanceUIDs(value: unknown): string | null {
  if (value == null) {
    return null;
  }
  if (Array.isArray(value)) {
    const joined = value.filter(Boolean).join(',');
    return joined || null;
  }
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }
  return null;
}

/**
 * If RIS sends an absolute URL to this app, return pathname + search for in-app navigation.
 * If it is another origin, caller should use full navigation.
 */
function sameOriginPathFromFullUrl(
  fullUrl: string,
  routerBasename: string
): { path: string } | { external: string } | null {
  try {
    const resolved = new URL(fullUrl, window.location.href);
    if (resolved.origin === window.location.origin) {
      const pathOnly = stripBasenameFromPathname(resolved.pathname, routerBasename);
      return { path: `${pathOnly}${resolved.search}${resolved.hash}` };
    }
    return { external: resolved.href };
  } catch {
    return null;
  }
}

function buildModePath(
  mode: string,
  dataSource: string | undefined,
  studyInstanceUIDs: string
): string {
  const params = new URLSearchParams();
  params.set('StudyInstanceUIDs', studyInstanceUIDs);
  const base = dataSource ? `${mode}/${dataSource}` : mode;
  const search = params.toString();
  return `/${base}?${search}`;
}

/** React Router `navigate` paths are relative to basename; strip it from a real pathname. */
function stripBasenameFromPathname(pathname: string, basename: string): string {
  if (!basename || basename === '/') {
    return pathname || '/';
  }
  const base = basename.endsWith('/') ? basename.slice(0, -1) : basename;
  if (pathname === base || pathname === `${base}/`) {
    return '/';
  }
  if (pathname.startsWith(`${base}/`)) {
    const rest = pathname.slice(base.length);
    return rest || '/';
  }
  return pathname;
}

function getAllowedOrigins(cfg?: RisPostMessageConfig | null): string[] {
  return (cfg?.allowedOrigins || []).filter(Boolean);
}

function notifyRisViewerReady(allowedOrigins: string[]) {
  if (!allowedOrigins.length) return;

  const payload = {
    source: MESSAGE_SOURCE_VIEWER,
    type: VIEWER_READY,
  };

  const targets: Window[] = [];
  try {
    if (window.opener && !window.opener.closed) {
      targets.push(window.opener);
    }
  } catch {
    /* cross-origin opener may throw */
  }
  if (window.parent && window.parent !== window) {
    targets.push(window.parent);
  }

  for (const target of targets) {
    for (const origin of allowedOrigins) {
      try {
        target.postMessage(payload, origin);
      } catch {
        /* ignore invalid target/origin pairs */
      }
    }
  }
}

function applyAuthSessionPayload(data: Record<string, unknown>) {
  const win = window as Window & {
    applyRisAuthSessionPayload?: (payload: Record<string, unknown>) => boolean;
    applyRisAuthSessionFromPostMessage?: (payload: Record<string, unknown>) => void;
  };
  // Prefer unified early-bridge helper (sets __RIS_AUTH_TOKEN + sessionStorage + cookies).
  if (typeof win.applyRisAuthSessionPayload === 'function') {
    win.applyRisAuthSessionPayload(data);
    return;
  }
  if (typeof win.applyRisAuthSessionFromPostMessage === 'function') {
    win.applyRisAuthSessionFromPostMessage(data);
    return;
  }
  console.warn('[RisPostMessageBridge] AUTH_SESSION apply helper is not available');
}

/**
 * Listens for postMessage from parent RIS:
 * - AUTH_SESSION: cross-origin token + preference cookies
 * - LOAD_STUDY: switch study in-tab via SPA navigation
 */
export default function RisPostMessageBridge() {
  const navigate = useNavigate();
  const [appConfig] = useAppConfig();
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;

  useEffect(() => {
    const cfg = appConfig?.risPostMessage;
    const authCfg = appConfig?.risAuthSession ?? cfg;
    const allowedOrigins = getAllowedOrigins(cfg);
    if (!allowedOrigins.length) {
      return;
    }

    const allowed = new Set(allowedOrigins);
    const routerBasename = appConfig?.routerBasename || '/';
    const loadStudyEnabled = cfg?.enabled !== false;
    const authSessionEnabled = authCfg?.enabled !== false;

    let readyTimer: number | undefined;
    let readyTimer2: number | undefined;
    if (authSessionEnabled) {
      notifyRisViewerReady(allowedOrigins);
      readyTimer = window.setTimeout(() => notifyRisViewerReady(allowedOrigins), 500);
      readyTimer2 = window.setTimeout(() => notifyRisViewerReady(allowedOrigins), 2000);
    }

    const handler = (event: MessageEvent) => {
      if (!allowed.has(event.origin)) {
        return;
      }

      const d = event.data;
      if (!d || typeof d !== 'object' || d.source !== MESSAGE_SOURCE_RIS) {
        return;
      }

      if (d.type === AUTH_SESSION) {
        if (!authSessionEnabled) return;
        applyAuthSessionPayload(d as Record<string, unknown>);
        return;
      }

      if (!loadStudyEnabled || d.type !== LOAD_STUDY) {
        return;
      }

      const studyUids = normalizeStudyInstanceUIDs(d.StudyInstanceUIDs);
      const fullUrl = typeof d.fullUrl === 'string' && d.fullUrl.trim() ? d.fullUrl.trim() : null;
      const mode = typeof d.mode === 'string' && d.mode.trim() ? d.mode.trim() : null;
      const dataSource =
        typeof d.dataSource === 'string' && d.dataSource.trim() ? d.dataSource.trim() : undefined;

      const go = (to: string) => {
        navigateRef.current(to, { replace: true });
      };

      if (fullUrl) {
        const parsed = sameOriginPathFromFullUrl(fullUrl, routerBasename);
        if (parsed && 'path' in parsed) {
          go(parsed.path);
        } else if (parsed && 'external' in parsed) {
          window.location.assign(parsed.external);
        } else {
          const fallback = fullUrl.startsWith('/') ? fullUrl : `/${fullUrl}`;
          go(fallback);
        }
        return;
      }

      if (!studyUids) {
        console.warn('[RisPostMessageBridge] LOAD_STUDY missing StudyInstanceUIDs and fullUrl');
        return;
      }

      if (!mode) {
        console.warn('[RisPostMessageBridge] LOAD_STUDY without fullUrl requires mode');
        return;
      }

      go(buildModePath(mode, dataSource, studyUids));
    };

    window.addEventListener('message', handler);
    return () => {
      window.clearTimeout(readyTimer);
      window.clearTimeout(readyTimer2);
      window.removeEventListener('message', handler);
    };
  }, [appConfig]);

  return null;
}
