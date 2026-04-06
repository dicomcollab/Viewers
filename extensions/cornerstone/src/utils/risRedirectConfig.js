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

const FALLBACK_RIS_LOGIN_URL = 'https://synapse.med-pacs.com/login';
const FALLBACK_RIS_API_BASE =
  'https://med-pacs-dev-risapi-fgb0frguhuaqgrfs.eastus-01.azurewebsites.net';

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
  return readEnv('REACT_APP_RIS_LOGIN_URL') || FALLBACK_RIS_LOGIN_URL;
}

/** Same rules as resolveRisPreferencesApiBaseUrl in @ohif/core */
export function resolveRisPreferencesApiBaseUrlLocal() {
  const fromEnv = readEnv('REACT_APP_BACKEND_HOTKEY_URL');
  if (fromEnv) {
    return fromEnv.replace(/\/$/, '');
  }
  const base = (readEnv('REACT_APP_RIS_API_BASE') || FALLBACK_RIS_API_BASE).replace(/\/$/, '');
  return `${base}/api/v1/preferences`;
}
