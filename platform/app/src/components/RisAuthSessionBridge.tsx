import { useEffect } from 'react';
import { useAppConfig } from '@state';

const MESSAGE_SOURCE = 'DICOMRIS';
const AUTH_SESSION = 'AUTH_SESSION';
const VIEWER_SOURCE = 'DICOMRIS_VIEWER';
const VIEWER_READY = 'VIEWER_READY';

/**
 * React-layer backup for RIS AUTH_SESSION handoff.
 * Early bootstrap lives in public/config/default.js (app-config.js); this covers
 * late mounts and re-announces VIEWER_READY if auth is still missing.
 */
export default function RisAuthSessionBridge() {
  const [appConfig] = useAppConfig();

  useEffect(() => {
    const cfg = appConfig?.risAuthSession ?? appConfig?.risPostMessage;
    if (cfg?.enabled === false) {
      return;
    }
    const origins: string[] = Array.isArray(cfg?.allowedOrigins)
      ? cfg.allowedOrigins.filter(Boolean)
      : [];

    if (!origins.length) {
      return;
    }

    const allowed = new Set(origins);
    const win = window as Window & {
      __RIS_AUTH_RECEIVED?: boolean;
      __RIS_AUTH_PENDING?: boolean;
      applyRisAuthSessionPayload?: (payload: unknown) => boolean;
      postViewerReadyToRis?: () => void;
      getViewerAccessBearerToken?: () => string | null;
    };

    const hasToken = () => {
      if (typeof win.getViewerAccessBearerToken === 'function') {
        const t = win.getViewerAccessBearerToken();
        if (t && String(t).trim()) return true;
      }
      return Boolean(win.__RIS_AUTH_RECEIVED);
    };

    const handler = (event: MessageEvent) => {
      if (!allowed.has(event.origin)) return;
      const data = event.data;
      if (!data || typeof data !== 'object') return;
      if (data.source !== MESSAGE_SOURCE || data.type !== AUTH_SESSION) return;

      if (typeof win.applyRisAuthSessionPayload === 'function') {
        win.applyRisAuthSessionPayload(data);
      }
    };

    window.addEventListener('message', handler);

    // Re-announce readiness if auth still missing (iframe / popup).
    let intervalId: ReturnType<typeof setInterval> | undefined;
    try {
      const embedded =
        (window.opener && !window.opener.closed) ||
        (window.parent && window.parent !== window);
      if (embedded && !hasToken()) {
        win.__RIS_AUTH_PENDING = true;
        const announce = () => {
          if (typeof win.postViewerReadyToRis === 'function') {
            win.postViewerReadyToRis();
            return;
          }
          const msg = { source: VIEWER_SOURCE, type: VIEWER_READY };
          const targets: Window[] = [];
          if (window.opener && !window.opener.closed) targets.push(window.opener);
          if (window.parent && window.parent !== window) targets.push(window.parent);
          targets.forEach(target => {
            origins.forEach(origin => {
              try {
                target.postMessage(msg, origin);
              } catch {
                /* ignore */
              }
            });
          });
        };
        announce();
        let n = 0;
        intervalId = setInterval(() => {
          n += 1;
          if (hasToken() || n >= 40) {
            win.__RIS_AUTH_PENDING = false;
            if (intervalId) clearInterval(intervalId);
            return;
          }
          announce();
        }, 250);
      }
    } catch {
      /* ignore cross-origin parent access */
    }

    return () => {
      window.removeEventListener('message', handler);
      if (intervalId) clearInterval(intervalId);
    };
  }, [appConfig]);

  return null;
}
