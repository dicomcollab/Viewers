/**
 * RIS redirect URL resolution for the cornerstone extension only.
 * Duplicates logic from @ohif/core risEnvironmentDefaults — do not import @ohif/core here:
 * that creates a circular dependency and can break JPEG loading (stuck "Loading images...").
 */

function readEnv(key) {
  if (typeof process === 'undefined' || !process.env) {
    return undefined;
  }
  const v = process.env[key];
  if (typeof v !== 'string' || v.trim() === '') {
    return undefined;
  }
  return v.trim();
}

const RIS_DEV_PORTAL_ORIGIN = readEnv('RIS_DEV_PORTAL_ORIGIN') || 'http://localhost:5173';
const RIS_DEV_API_BASE = readEnv('RIS_DEV_API_BASE') || 'http://localhost:5001';

function readRisProdPortalOrigin() {
  return readEnv('RIS_PROD_PORTAL_ORIGIN') || '';
}

function readRisProdApiBase() {
  return readEnv('RIS_PROD_API_BASE') || '';
}

function readRisPortalFromWindowConfig() {
  if (typeof window === 'undefined' || !window.config) {
    return undefined;
  }
  const worklist = window.config.risWorklistUrl?.trim();
  if (worklist) {
    try {
      return new URL(worklist).origin;
    } catch {
      /* ignore */
    }
  }
  return undefined;
}

function isRisDevMode(appConfig) {
  if (appConfig?.isDev === true) {
    return true;
  }
  if (appConfig?.isDev === false) {
    return false;
  }
  if (typeof window !== 'undefined' && window.config) {
    if (window.config.isDev === true) {
      return true;
    }
    if (window.config.isDev === false) {
      return false;
    }
  }
  return false;
}

function getFallbackRisLoginUrl(appConfig) {
  if (isRisDevMode(appConfig)) {
    return `${RIS_DEV_PORTAL_ORIGIN}/login`;
  }
  const portal = readRisProdPortalOrigin() || readRisPortalFromWindowConfig() || '';
  return portal ? `${portal}/login` : '';
}

function getFallbackRisApiBase(appConfig) {
  if (isRisDevMode(appConfig)) {
    return RIS_DEV_API_BASE;
  }
  const fromWindow =
    typeof window !== 'undefined' ? window.config?.risApiBase?.trim() : undefined;
  if (fromWindow) {
    return fromWindow.replace(/\/$/, '');
  }
  return readRisProdApiBase();
}

export function isRedirectToRisOn401Enabled(appConfig) {
  return appConfig?.redirectToRisOn401 !== false;
}

/** Same rules as resolveRis401RedirectUrlFromConfig in @ohif/core */
export function resolveRis401RedirectUrlFromConfig(appConfig) {
  const explicit = appConfig?.risAuthRedirectUrl?.trim();
  if (explicit) {
    return explicit;
  }
  if (appConfig?.risWorklistUrl) {
    return appConfig.risWorklistUrl;
  }
  return readEnv('REACT_APP_RIS_LOGIN_URL') || getFallbackRisLoginUrl(appConfig);
}

/** Same rules as resolveRisPreferencesApiBaseUrl in @ohif/core */
export function resolveRisPreferencesApiBaseUrlLocal(appConfig) {
  const fromEnv = readEnv('REACT_APP_BACKEND_HOTKEY_URL');
  if (fromEnv) {
    return fromEnv.replace(/\/$/, '');
  }
  const base = (readEnv('REACT_APP_RIS_API_BASE') || getFallbackRisApiBase(appConfig)).replace(
    /\/$/,
    ''
  );
  return base ? `${base}/api/v1/preferences` : '';
}
