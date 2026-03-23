import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppConfig } from '@state';

const MESSAGE_SOURCE = 'DICOMRIS';
const LOAD_STUDY = 'LOAD_STUDY';

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

/**
 * Listens for postMessage from the parent RIS so one viewer tab can switch studies via SPA
 * navigation (replace) instead of opening a new tab or doing a full page load.
 *
 * RIS example:
 *   viewerWindow.postMessage(
 *     {
 *       source: 'DICOMRIS',
 *       type: 'LOAD_STUDY',
 *       StudyInstanceUIDs: '1.2.840...',
 *       mode: 'viewer',
 *       dataSource: 'dicomweb',
 *       // optional — same viewer origin path or absolute URL:
 *       fullUrl: '/viewer/dicomweb?StudyInstanceUIDs=1.2.840...',
 *     },
 *     'https://viewer-origin'
 *   );
 */
export default function RisPostMessageBridge() {
  const navigate = useNavigate();
  const [appConfig] = useAppConfig();
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;

  useEffect(() => {
    const cfg = appConfig?.risPostMessage;
    if (!cfg?.enabled || !cfg?.allowedOrigins?.length) {
      return;
    }

    const allowed = new Set(cfg.allowedOrigins);
    const routerBasename = appConfig?.routerBasename || '/';

    const handler = (event: MessageEvent) => {
      if (!allowed.has(event.origin)) {
        return;
      }

      const d = event.data;
      if (!d || typeof d !== 'object') {
        return;
      }
      if (d.source !== MESSAGE_SOURCE || d.type !== LOAD_STUDY) {
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
    return () => window.removeEventListener('message', handler);
  }, [appConfig]);

  return null;
}
