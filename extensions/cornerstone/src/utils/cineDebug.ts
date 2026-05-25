/**
 * Cine debug logging. Enable in browser console:
 *   window.OHIF_DEBUG_CINE = true
 * or set localStorage 'ohif-debug-cine' = '1'
 */
const CINE_DEBUG_STORAGE_KEY = 'ohif-debug-cine';

export function isCineDebugEnabled(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  return (
    (window as Window & { OHIF_DEBUG_CINE?: boolean }).OHIF_DEBUG_CINE === true ||
    localStorage.getItem(CINE_DEBUG_STORAGE_KEY) === '1'
  );
}

export function cineDebug(scope: string, message: string, data?: Record<string, unknown>) {
  if (!isCineDebugEnabled()) {
    return;
  }

  const prefix = `[OHIF Cine][${scope}]`;

  if (data !== undefined) {
    console.log(prefix, message, data);
  } else {
    console.log(prefix, message);
  }
}

export function cineDebugWarn(scope: string, message: string, data?: Record<string, unknown>) {
  if (!isCineDebugEnabled()) {
    return;
  }

  const prefix = `[OHIF Cine][${scope}]`;

  if (data !== undefined) {
    console.warn(prefix, message, data);
  } else {
    console.warn(prefix, message);
  }
}

export function cineDebugError(scope: string, message: string, error?: unknown) {
  if (!isCineDebugEnabled()) {
    return;
  }

  console.error(`[OHIF Cine][${scope}]`, message, error);
}
