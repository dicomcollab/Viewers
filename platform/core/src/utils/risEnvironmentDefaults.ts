/**
 * Central RIS / Synapse URL defaults and optional build-time overrides.
 *
 * The cornerstone extension duplicates 401/preferences URL logic in
 * `extensions/cornerstone/src/utils/risRedirectConfig.js` (no import from here) to avoid
 * circular deps that can break JPEG loading.
 *
 * Build-time (.env / CI), if needed:
 * - REACT_APP_RIS_WORKLIST_URL
 * - REACT_APP_RIS_LOGIN_URL
 * - REACT_APP_RIS_API_BASE
 * - REACT_APP_BACKEND_HOTKEY_URL (full …/api/v1/preferences base)
 * - RIS_PROD_PORTAL_ORIGIN / RIS_PROD_API_BASE / RIS_DEV_PORTAL_ORIGIN / RIS_DEV_API_BASE
 */

export type RisAppConfigSlice = {
  /** When true, use local RIS portal + dev API fallbacks (see default.js isDev). */
  isDev?: boolean;
  risWorklistUrl?: string;
  risAuthRedirectUrl?: string;
  risRootRedirectUrl?: string;
  /** Optional RIS REST API origin (no trailing slash); else REACT_APP_RIS_API_BASE / built-in dev URL. */
  risApiBase?: string;
  /** When false, do not send users to RIS on 401 / unauthenticated. Default: enabled. */
  redirectToRisOn401?: boolean;
  /** When false, `/` does not redirect externally (use OHIF worklist). */
  redirectRootToRis?: boolean;
};

function readEnv(key: string): string | undefined {
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

function readRisProdPortalOrigin(): string {
  return readEnv('RIS_PROD_PORTAL_ORIGIN') || '';
}

function readRisProdApiBase(): string {
  return readEnv('RIS_PROD_API_BASE') || '';
}

function readRisPortalFromWindowConfig(): string | undefined {
  if (typeof window === 'undefined') {
    return undefined;
  }
  const cfg = (window as unknown as { config?: RisAppConfigSlice }).config;
  const worklist = cfg?.risWorklistUrl?.trim();
  if (worklist) {
    try {
      return new URL(worklist).origin;
    } catch {
      /* ignore */
    }
  }
  return undefined;
}

function isRisDevMode(appConfig?: RisAppConfigSlice | null): boolean {
  if (appConfig?.isDev === true) {
    return true;
  }
  if (appConfig?.isDev === false) {
    return false;
  }
  if (typeof window !== 'undefined') {
    const fromWindow = (window as unknown as { config?: RisAppConfigSlice }).config?.isDev;
    if (fromWindow === true) {
      return true;
    }
    if (fromWindow === false) {
      return false;
    }
  }
  return false;
}

function getFallbackRisPortalOrigin(appConfig?: RisAppConfigSlice | null): string {
  if (isRisDevMode(appConfig)) {
    return RIS_DEV_PORTAL_ORIGIN;
  }
  return readRisProdPortalOrigin() || readRisPortalFromWindowConfig() || '';
}

function getFallbackRisApiBase(appConfig?: RisAppConfigSlice | null): string {
  if (isRisDevMode(appConfig)) {
    return RIS_DEV_API_BASE;
  }
  const fromWindow =
    typeof window !== 'undefined'
      ? (window as unknown as { config?: RisAppConfigSlice }).config?.risApiBase?.trim()
      : undefined;
  if (fromWindow) {
    return fromWindow.replace(/\/$/, '');
  }
  return readRisProdApiBase();
}

export function getDefaultRisWorklistUrl(appConfig?: RisAppConfigSlice | null): string {
  const fromEnv = readEnv('REACT_APP_RIS_WORKLIST_URL');
  if (fromEnv) {
    return fromEnv;
  }
  const portal = getFallbackRisPortalOrigin(appConfig);
  return portal ? `${portal}/worklist` : '';
}

export function getDefaultRisLoginUrl(appConfig?: RisAppConfigSlice | null): string {
  const fromEnv = readEnv('REACT_APP_RIS_LOGIN_URL');
  if (fromEnv) {
    return fromEnv;
  }
  const portal = getFallbackRisPortalOrigin(appConfig);
  return portal ? `${portal}/login` : '';
}

export function getDefaultRisApiBase(appConfig?: RisAppConfigSlice | null): string {
  return readEnv('REACT_APP_RIS_API_BASE') || getFallbackRisApiBase(appConfig);
}

export function getDefaultRisPortalOrigin(appConfig?: RisAppConfigSlice | null): string {
  try {
    const worklist = getDefaultRisWorklistUrl(appConfig);
    if (worklist) {
      return new URL(worklist).origin;
    }
  } catch {
    /* fall through */
  }
  return getFallbackRisPortalOrigin(appConfig);
}

export function resolveRisApiBaseFromConfig(appConfig?: RisAppConfigSlice | null): string {
  const explicit = appConfig?.risApiBase?.trim();
  if (explicit) {
    return explicit.replace(/\/$/, '');
  }
  return getDefaultRisApiBase(appConfig).replace(/\/$/, '');
}

export function resolveRisPreferencesApiBaseUrl(appConfig?: RisAppConfigSlice | null): string {
  const fromEnv = readEnv('REACT_APP_BACKEND_HOTKEY_URL');
  if (fromEnv) {
    return fromEnv.replace(/\/$/, '');
  }
  const base = getDefaultRisApiBase(appConfig).replace(/\/$/, '');
  return base ? `${base}/api/v1/preferences` : '';
}

const DEFAULT_VIEW_DICOM_IMG_PATH = '/api/v1/handleDicom/viewDicomImg';

/**
 * JWT / session token for RIS API (preferences, viewDicomImg), aligned with app config cookie resolution.
 */
export function getRisAuthTokenFromBrowserCookies(): string | null {
  if (typeof window === 'undefined') {
    return null;
  }
  if (typeof document === 'undefined' || !document.cookie) {
    return null;
  }
  const names = ['token', 'patientToken', 'accessToken', 'authToken', 'jwt'];
  for (const name of names) {
    const nameEQ = `${name}=`;
    const parts = document.cookie.split(';');
    for (let i = 0; i < parts.length; i++) {
      let c = parts[i].trim();
      if (c.indexOf(nameEQ) === 0) {
        const v = decodeURIComponent(c.substring(nameEQ.length).trim());
        if (v) {
          return v;
        }
      }
    }
  }
  return null;
}

export type RisViewDicomImgResult = {
  /** Optional viewer URL from API (e.g. Lens); not used for Synapse createreport flow. */
  viewerUrl?: string;
  dicomData?: {
    _id?: string;
    studyUID?: string;
  };
};

/**
 * POST viewDicomImg; returns `dicomData` (for `/createreport/{_id}/{studyUID}`) and optional `data.url`.
 */
export async function fetchRisViewDicomImg(options: {
  studyUID: string;
  token: string;
  apiBase?: string;
  path?: string;
}): Promise<RisViewDicomImgResult> {
  const base = (options.apiBase || getDefaultRisApiBase()).replace(/\/$/, '');
  const path = options.path || DEFAULT_VIEW_DICOM_IMG_PATH;
  const url = `${base}${path.startsWith('/') ? path : `/${path}`}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Token: options.token,
    },
    body: JSON.stringify({ studyUID: options.studyUID }),
  });
  if (!res.ok) {
    throw new Error(`viewDicomImg HTTP ${res.status}`);
  }
  const json = (await res.json()) as {
    error?: boolean;
    message?: string;
    data?: {
      url?: string;
      dicomData?: { _id?: string; studyUID?: string };
    };
  };
  if (json?.error) {
    throw new Error(json?.message || 'viewDicomImg reported an error');
  }
  const data = json?.data;
  const viewerUrl =
    data?.url && typeof data.url === 'string' && data.url.trim() ? data.url.trim() : undefined;
  const raw = data?.dicomData;
  const dicomData =
    raw && typeof raw === 'object'
      ? { _id: raw._id, studyUID: raw.studyUID }
      : undefined;
  return { viewerUrl, dicomData };
}

export function resolveRisWorklistUrlFromConfig(appConfig?: RisAppConfigSlice | null): string {
  if (appConfig?.risWorklistUrl) {
    return appConfig.risWorklistUrl;
  }
  return getDefaultRisWorklistUrl(appConfig);
}

/**
 * Target for `/` when redirecting to RIS (explicit risRootRedirectUrl, else worklist resolution).
 */
export function resolveRisRootRedirectUrlFromConfig(appConfig?: RisAppConfigSlice | null): string {
  const explicit = appConfig?.risRootRedirectUrl?.trim();
  if (explicit) {
    return explicit;
  }
  return resolveRisWorklistUrlFromConfig(appConfig);
}

/**
 * Target for 401 / auth failure (explicit risAuthRedirectUrl, else risWorklistUrl, else login default).
 */
export function resolveRis401RedirectUrlFromConfig(appConfig?: RisAppConfigSlice | null): string {
  const explicit = appConfig?.risAuthRedirectUrl?.trim();
  if (explicit) {
    return explicit;
  }
  if (appConfig?.risWorklistUrl) {
    return appConfig.risWorklistUrl;
  }
  return getDefaultRisLoginUrl(appConfig);
}

export function isRedirectToRisOn401Enabled(appConfig?: RisAppConfigSlice | null): boolean {
  return appConfig?.redirectToRisOn401 !== false;
}
