// Demo token - Set your basic token here for the demo datasource
// This will be sent as: Authorization: Basic YOUR_TOKEN
// Example: If token is "QjdYOVYzTFEyWlc4TTZSRkQwSjVQWVQ0S04xR0hTVTpCN1g5VjNMUTJaVzhNNlJGRDBKNVBZVDRLTjFHSFNV"
// It will be sent as: Authorization: Basic QjdYOVYzTFEyWlc4TTZSRkQwSjVQWVQ0S04xR0hTVTpCN1g5VjNMUTJaVzhNNlJGRDBKNVBZVDRLTjFHSFNV
const DEMO_TOKEN =
  'QjdYOVYzTFEyWlc4TTZSRkQwSjVQWVQ0S04xR0hTVTpaNE0xSzlGOFFYN1RSRDVXMkxDVjBCSk42U0dZSFAz'; // Replace with your actual token (e.g., "QjdYOVYzTFEyWlc4TTZSRkQwSjVQWVQ0S04xR0hTVTpCN1g5VjNMUTJaVzhNNlJGRDBKNVBZVDRLTjFHSFNV")

/**
 * Base64(user:pass) for URLs under /external/viewer — Authorization: Basic …
 * No cookie/session token required for PACS on that route. Change per environment.
 */
const EXTERNAL_VIEWER_BASIC_TOKEN = DEMO_TOKEN;

// Demo study UID - Only this study will use the demo token
const DEMO_STUDY_UID = '1.2.840.113619.2.55.3.4271045733.996.1449464144.595';

// ---------------------------------------------------------------------------
// PACS integration: driven by cookie userPreferences_dicomSourceType (read at load):
//   "medpacs" -> medpacs; "dicom_service" -> azurepacs; missing/unknown -> medpacs
// medpacs = Med-PACS DICOMweb (cookie/Basic, /api).
// azurepacs = DICOM service route (/dicomservice via resolver), same host as Med-PACS when proxied.
// ---------------------------------------------------------------------------
function readCookieRawForPacs(name) {
  if (typeof document === 'undefined' || !document.cookie) {
    return null;
  }
  const nameEQ = name + '=';
  const cookies = document.cookie.split(';');
  for (let i = 0; i < cookies.length; i++) {
    let cookie = cookies[i].trim();
    if (cookie.indexOf(nameEQ) === 0) {
      try {
        return decodeURIComponent(cookie.substring(nameEQ.length).trim());
      } catch (_) {
        return cookie.substring(nameEQ.length).trim();
      }
    }
  }
  return null;
}

function parseDicomSourceTypeCookieValue(raw) {
  if (raw == null || raw === '') {
    return null;
  }
  const trimmed = String(raw).trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    trimmed.startsWith('[') ||
    trimmed.startsWith('{')
  ) {
    try {
      return JSON.parse(trimmed);
    } catch (_) {
      return trimmed;
    }
  }
  return trimmed;
}

function resolvePacsIntegrationFromDicomSourceCookie() {
  const raw = readCookieRawForPacs('userPreferences_dicomSourceType');
  if (raw == null || raw === '') {
    return 'medpacs';
  }
  const v = String(parseDicomSourceTypeCookieValue(raw) ?? raw).trim();
  if (v === 'dicom_service') {
    return 'azurepacs';
  }
  if (v === 'medpacs') {
    return 'medpacs';
  }
  return 'medpacs';
}

const PACS_INTEGRATION = resolvePacsIntegrationFromDicomSourceCookie();

// When true, /dicomservice/* uses the same Bearer token as Med-PACS (cookieAuth). Set false if you call Azure Healthcare APIs directly with AZURE_PACS_TOKEN.
const AZURE_PACS_PREFER_COOKIE_AUTH = true;

const MED_PACS_DICOMWEB_API_ROOT =
  'https://med-pacs-dev-dicomcloudwebapi-linux-cyhzgxbbb5hqcgby.eastus-01.azurewebsites.net/api';
// Legacy separate /wadouri path (JPEG WADO-URI). Raw DICOM WADO-URI uses MED_PACS_DICOMWEB_API_ROOT + query params.
const MED_PACS_DICOMWEB_WADOURI_ROOT =
  'https://med-pacs-dev-dicomcloudwebapi-linux-cyhzgxbbb5hqcgby.eastus-01.azurewebsites.net/wadouri';

const AZURE_PACS_TOKEN_PLACEHOLDER = 'YOUR_AZURE_DICOM_TOKEN_HERE';
let AZURE_PACS_INITIAL_TOKEN = AZURE_PACS_TOKEN_PLACEHOLDER;
let _cachedAzurePacsToken = AZURE_PACS_INITIAL_TOKEN;

function getAzurePacsToken() {
  return _cachedAzurePacsToken;
}

function updateAzurePacsTokenEverywhere(newToken) {
  if (PACS_INTEGRATION !== 'azurepacs' || !newToken || typeof newToken !== 'string') {
    return;
  }
  _cachedAzurePacsToken = newToken;
  if (typeof window !== 'undefined') {
    if (!AZURE_PACS_PREFER_COOKIE_AUTH) {
      window.AZURE_PACS_TOKEN = newToken;
    }
    if (!AZURE_PACS_PREFER_COOKIE_AUTH && window.config && window.config.dataSources) {
      window.config.dataSources.forEach(function (ds) {
        if (
          ds.configuration &&
          Object.prototype.hasOwnProperty.call(ds.configuration, 'azureToken')
        ) {
          ds.configuration.azureToken = newToken;
        }
      });
    }
  }
}

// Azure PACS: same host as Med-PACS DICOMweb; your API proxies /dicomservice/* to Azure Healthcare DICOM.
// getAzureDicomV2BaseUrl() appends /v2; DicomWebDataSource maps .../v2 -> .../dicomservice when pacsIntegration is azurepacs.
const AZURE_DICOM_SERVICE_URL =
  'https://med-pacs-dev-dicomcloudwebapi-linux-cyhzgxbbb5hqcgby.eastus-01.azurewebsites.net';

function getAzureDicomV2BaseUrl() {
  const baseUrl = AZURE_DICOM_SERVICE_URL.replace(/\/v\d+\/?$/, '').replace(/\/$/, '');
  return `${baseUrl}/v2`;
}

var FRAME_RETRIEVAL_DATA_SOURCE_OPTIONS = [
  {
    sourceName: 'frame-multipart-octet-wildcard',
    friendlyName: 'Multipart octet-stream (transfer-syntax=*)',
    acceptHeader: ['multipart/related; type="application/octet-stream"; transfer-syntax=*'],
  },
  {
    sourceName: 'frame-multipart-octet-default',
    friendlyName: 'Multipart octet-stream (default 1.2.840.10008.1.2.1)',
    acceptHeader: [
      'multipart/related; type="application/octet-stream"; transfer-syntax=1.2.840.10008.1.2.1',
    ],
  },
  {
    sourceName: 'frame-multipart-octet-explicit',
    friendlyName: 'Multipart octet-stream (Little Endian Explicit)',
    acceptHeader: [
      'multipart/related; type="application/octet-stream"; transfer-syntax=1.2.840.10008.1.2.1',
    ],
  },
  {
    sourceName: 'frame-multipart-jp2-default',
    friendlyName: 'Multipart image/jp2 (default 1.2.840.10008.1.2.4.90)',
    acceptHeader: ['multipart/related; type="image/jp2"; transfer-syntax=1.2.840.10008.1.2.4.90'],
  },
  {
    sourceName: 'frame-multipart-jp2-90',
    friendlyName: 'Multipart image/jp2 (JPEG 2000 Lossless)',
    acceptHeader: ['multipart/related; type="image/jp2"; transfer-syntax=1.2.840.10008.1.2.4.90'],
  },
  {
    sourceName: 'frame-single-octet-wildcard',
    friendlyName: 'Single frame application/octet-stream (transfer-syntax=*)',
    acceptHeader: ['application/octet-stream; transfer-syntax=*'],
  },
  {
    sourceName: 'frame-any-default',
    friendlyName: 'Any (*/*, default application/octet-stream)',
    acceptHeader: ['*/*'],
  },
];

function getAzurePacsFrameRetrievalDataSources() {
  var baseUrl = getAzureDicomV2BaseUrl();
  var token = getAzurePacsToken();
  return FRAME_RETRIEVAL_DATA_SOURCE_OPTIONS.map(function (opt) {
    return {
      namespace: '@ohif/extension-default.dataSourcesModule.dicomweb',
      sourceName: opt.sourceName,
      configuration: {
        friendlyName: 'Azure PACS (Frame: ' + opt.friendlyName + ')',
        name: 'azure-pacs-v2-wadors',
        wadoUriRoot: baseUrl,
        qidoRoot: baseUrl,
        wadoRoot: baseUrl,
        qidoSupportsIncludeField: true,
        imageRendering: 'wadors',
        thumbnailRendering: 'wadors',
        enableStudyLazyLoad: true,
        supportsFuzzyMatching: true,
        supportsWildcard: true,
        staticWado: false,
        singlepart: 'bulkdata,video',
        bulkDataURI: {
          enabled: true,
          relativeResolution: 'studies',
          transform: function (url) {
            return url.replace('/pixeldata.mp4', '/rendered');
          },
        },
        omitQuotationForMultipartRequest: true,
        acceptHeader: opt.acceptHeader,
        isAzureDicomV2: true,
        azureToken: token,
      },
    };
  });
}

// Helper function to check if we're on a demo route
function isDemoRoute() {
  if (typeof window === 'undefined' || !window.location) {
    return false;
  }
  const urlParams = new URLSearchParams(window.location.search);
  const studyUIDs = urlParams.get('StudyInstanceUIDs') || urlParams.get('studyInstanceUIDs');
  const path = window.location.pathname;
  // Demo token: classic /demo route, or same study opened via localviewer-image-jpeg (redirected viewer)
  return (
    studyUIDs === DEMO_STUDY_UID &&
    (path.includes('/viewer/demo') ||
      path.includes('/demo') ||
      path.includes('/localviewer-image-jpeg'))
  );
}

// Function to get demo token if on demo route
function getDemoToken() {
  if (!isDemoRoute()) {
    return null;
  }
  if (DEMO_TOKEN && DEMO_TOKEN !== 'YOUR_DEMO_TOKEN_HERE') {
    return DEMO_TOKEN;
  }
  return null;
}

/**
 * Pathname relative to router basename (matches React Router), for auth route checks.
 */
function getAppPathnameForAuthRoutes() {
  if (typeof window === 'undefined' || !window.location) {
    return '';
  }
  let path = window.location.pathname || '';
  const cfg = window.config || {};
  let basename = cfg.routerBasename;
  if (basename == null || basename === '') {
    basename =
      typeof window.PUBLIC_URL !== 'undefined' && window.PUBLIC_URL ? window.PUBLIC_URL : '/';
  }
  basename = String(basename).replace(/\/$/, '');
  if (basename && basename !== '/' && path.startsWith(basename)) {
    path = path.slice(basename.length) || '/';
  }
  if (path && !path.startsWith('/')) {
    path = '/' + path;
  }
  return path;
}

/** Longitudinal viewer opened as /external/viewer — same UI as /viewer, fixed Basic auth to PACS */
function isExternalViewerRoute() {
  const path = getAppPathnameForAuthRoutes();
  return path === '/external/viewer' || path.startsWith('/external/viewer/');
}

/** Credential used for DICOMweb when pathname is /external/viewer (or /external/viewer/:source) */
function getExternalViewerBasicToken() {
  if (!isExternalViewerRoute()) {
    return null;
  }
  if (
    EXTERNAL_VIEWER_BASIC_TOKEN &&
    EXTERNAL_VIEWER_BASIC_TOKEN !== 'YOUR_EXTERNAL_VIEWER_BASIC_TOKEN_HERE'
  ) {
    return EXTERNAL_VIEWER_BASIC_TOKEN;
  }
  return null;
}

// RIS environment toggle — set true for local RIS dev; false for Synapse production.
// Align with platform/core risEnvironmentDefaults when changing these URLs.
const isDev = false;

const RIS_DEV_PORTAL_ORIGIN = 'http://192.168.1.120:5173';
const RIS_PROD_PORTAL_ORIGIN = 'https://synapse.med-pacs.com';
const RIS_DEV_API_BASE = 'https://med-pacs-dev-risapi-fgb0frguhuaqgrfs.eastus-01.azurewebsites.net';
const RIS_PROD_API_BASE = 'https://synapse.med-pacs.com';

const RIS_PORTAL_ORIGIN = isDev ? RIS_DEV_PORTAL_ORIGIN : RIS_PROD_PORTAL_ORIGIN;
const RIS_API_BASE = isDev ? RIS_DEV_API_BASE : RIS_PROD_API_BASE;
// Use same token as demo for share links, or set a dedicated share-link read-only token
const SHARE_LINK_BASIC_TOKEN = DEMO_TOKEN;

function getShortCodeFromUrl() {
  if (typeof window === 'undefined' || !window.location) return null;
  const urlParams = new URLSearchParams(window.location.search);
  return urlParams.get('ShortCode') || urlParams.get('shortcode') || null;
}

// Cache for check-expiry to avoid multiple API calls (e.g. on load + initial layout events)
var _shareLinkExpiryCache = { apiResponse: null, expiryState: null, shortCode: null, ts: 0 };
var SHARE_LINK_EXPIRY_CACHE_MS = 60000; // 1 minute - same shortCode reuses result

/**
 * Call RIS API to check if the share link (short code) is expired.
 * Stores result in window._shareLinkExpiry for use by getAuthorizationHeader.
 * Uses a short-lived cache so the API is only called once per shortCode per minute.
 * @param {string} shortCode
 * @returns {Promise<{ error: boolean, data?: { isExpired: boolean, expiresAt?: string, studyInstanceUID?: string }, errorMessage?: string }>}
 */
async function checkShortCodeExpiry(shortCode) {
  if (!shortCode) return { error: true, errorMessage: 'No shortCode' };

  const now = Date.now();
  if (
    _shareLinkExpiryCache.shortCode === shortCode &&
    _shareLinkExpiryCache.apiResponse != null &&
    now - _shareLinkExpiryCache.ts < SHARE_LINK_EXPIRY_CACHE_MS
  ) {
    if (typeof window !== 'undefined' && _shareLinkExpiryCache.expiryState) {
      window['_shareLinkExpiry'] = _shareLinkExpiryCache.expiryState;
    }
    return _shareLinkExpiryCache.apiResponse;
  }

  const url = `${RIS_API_BASE}/api/v1/shorturl/check-expiry/${encodeURIComponent(shortCode)}`;
  try {
    const res = await fetch(url);
    const json = await res.json();
    const expiryState =
      json.error === false && json.data
        ? {
            shortCode: json.data.shortCode,
            isExpired: json.data.isExpired,
            expiresAt: json.data.expiresAt,
            studyInstanceUID: json.data.studyInstanceUID,
          }
        : { isExpired: true };
    if (typeof window !== 'undefined') {
      window['_shareLinkExpiry'] = expiryState;
    }
    _shareLinkExpiryCache = {
      apiResponse: json,
      expiryState: expiryState,
      shortCode: shortCode,
      ts: now,
    };
    return json;
  } catch (err) {
    const expiryState = { isExpired: true, error: err?.message };
    if (typeof window !== 'undefined') {
      window['_shareLinkExpiry'] = expiryState;
    }
    const apiResponse = { error: true, errorMessage: err?.message || 'check-expiry failed' };
    _shareLinkExpiryCache = {
      apiResponse: apiResponse,
      expiryState: expiryState,
      shortCode: shortCode,
      ts: now,
    };
    return apiResponse;
  }
}

function isShareLinkMode() {
  return !!getShortCodeFromUrl();
}

function getShareLinkExpiryResult() {
  return typeof window !== 'undefined' ? window['_shareLinkExpiry'] : null;
}

function getShareLinkBasicToken() {
  if (!isShareLinkMode()) return null;
  const result = getShareLinkExpiryResult();
  if (!result || result.isExpired) return null;
  return SHARE_LINK_BASIC_TOKEN && SHARE_LINK_BASIC_TOKEN !== 'YOUR_DEMO_TOKEN_HERE'
    ? SHARE_LINK_BASIC_TOKEN
    : null;
}

// Make demo token globally accessible for extensions
if (typeof window !== 'undefined') {
  // @ts-expect-error - Adding custom property to window
  window.DEMO_TOKEN = DEMO_TOKEN;
  // @ts-expect-error - Adding custom property to window
  window.DEMO_STUDY_UID = DEMO_STUDY_UID;
  window.isDemoRoute = isDemoRoute;
  window.getDemoToken = getDemoToken;
  window.isExternalViewerRoute = isExternalViewerRoute;
  window.getExternalViewerBasicToken = getExternalViewerBasicToken;
  // Share link (ShortCode) helpers
  window.getShortCodeFromUrl = getShortCodeFromUrl;
  window.checkShortCodeExpiry = checkShortCodeExpiry;
  window.isShareLinkMode = isShareLinkMode;
  window.getShareLinkExpiryResult = getShareLinkExpiryResult;
  window.getShareLinkBasicToken = getShareLinkBasicToken;
  if (PACS_INTEGRATION === 'azurepacs') {
    if (!AZURE_PACS_PREFER_COOKIE_AUTH) {
      window.AZURE_PACS_TOKEN = _cachedAzurePacsToken;
    }
    window.getAzurePacsToken = getAzurePacsToken;
    window.updateAzurePacsTokenEverywhere = updateAzurePacsTokenEverywhere;
    window.getAzureDicomV2BaseUrl = getAzureDicomV2BaseUrl;
  }
}

// Helper function to get token from cookie (token or patientToken - either is passed to PACS API)
function getTokenFromCookie() {
  // Check for demo token first
  const demoToken = getDemoToken();
  if (demoToken) {
    return demoToken;
  }
  // Otherwise get token from cookie: try token then patientToken (parent app may set either)
  return (
    getCookie('token') ||
    getCookie('patientToken') ||
    getCookie('accessToken') ||
    getCookie('authToken') ||
    getCookie('jwt') ||
    null
  );
}

// Shared cache: one in-flight promise and resolved result so getPreferences is called only once per session
let _preferencesPromise = null;
let _preferencesCache = undefined;

const USER_PREFERENCES_COOKIE_PREFIX = 'userPreferences_';

/**
 * Get a cookie value by name from document.cookie
 * @param {string} name - Cookie name
 * @returns {string|null} Cookie value or null
 */
function getCookie(name) {
  if (typeof document === 'undefined' || !document.cookie) return null;
  const nameEQ = name + '=';
  const cookies = document.cookie.split(';');
  for (let i = 0; i < cookies.length; i++) {
    let cookie = cookies[i].trim();
    if (cookie.indexOf(nameEQ) === 0) {
      return decodeURIComponent(cookie.substring(nameEQ.length).trim());
    }
  }
  return null;
}

/**
 * Parse a cookie value that may be a JSON string (e.g. "#d952e6" or "[{...}]")
 * @param {string} value - Raw cookie value
 * @returns {*} Parsed value or original string
 */
function parseCookieValue(value) {
  if (value == null || value === '') return value;
  const trimmed = String(value).trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    trimmed.startsWith('[') ||
    trimmed.startsWith('{')
  ) {
    try {
      return JSON.parse(trimmed);
    } catch (_) {
      return value;
    }
  }
  return value;
}

/**
 * Read all user preferences from cookies (keys: userPreferences_*).
 * Maps cookie names to preference keys and parses JSON where needed.
 * Hotkeys may be split across userPreferences_hotkeys_0, userPreferences_hotkeys_1, etc.
 * @returns {Object|null} Preferences object in API shape, or null if no preference cookies found
 */
function getPreferencesFromCookies() {
  if (typeof document === 'undefined' || !document.cookie) {
    console.log('[getPreferencesFromCookies] No document or document.cookie');
    return null;
  }
  const cookieString = document.cookie;
  const cookies = cookieString.split(';');
  const raw = {};
  const foundCookieNames = [];
  for (let i = 0; i < cookies.length; i++) {
    const trimmed = cookies[i].trim();
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx < 0) continue;
    const namePart = trimmed.slice(0, eqIdx).trim();
    let name;
    try {
      name = decodeURIComponent(namePart);
    } catch (_) {
      name = namePart;
    }
    name = name.replace(/^\uFEFF/, '').trim(); // BOM
    const value = trimmed.slice(eqIdx + 1).trim();
    let decoded;
    try {
      decoded = decodeURIComponent(value);
    } catch (e) {
      decoded = value;
    }
    // Match userPreferences_* cookies
    if (name.startsWith(USER_PREFERENCES_COOKIE_PREFIX)) {
      foundCookieNames.push(name);
      const key = name.slice(USER_PREFERENCES_COOKIE_PREFIX.length);
      if (key.startsWith('hotkeys_')) {
        const index = key.replace(/^hotkeys_/, ''); // "hotkeys_0" -> "0"
        if (!raw._hotkeysParts) raw._hotkeysParts = {};
        raw._hotkeysParts[index] = decoded;
      } else {
        raw[key] = decoded;
      }
      continue;
    }
    // Fallback: some backends set cookies as hotkeys_0, hotkeys_1 without userPreferences_ prefix
    if (name === 'hotkeys_0' || name === 'hotkeys_1' || /^hotkeys_\d+$/.test(name)) {
      const index = name.replace('hotkeys_', '');
      if (!raw._hotkeysParts) raw._hotkeysParts = {};
      raw._hotkeysParts[index] = decoded;
      foundCookieNames.push('(fallback) ' + name);
    }
  }
  const hasHotkeysParts = raw._hotkeysParts && Object.keys(raw._hotkeysParts).length > 0;
  console.log(
    '[getPreferencesFromCookies] userPreferences_ cookies found:',
    foundCookieNames,
    '| hotkeys parts:',
    hasHotkeysParts ? Object.keys(raw._hotkeysParts) : 'none',
    '| cookie names in document.cookie:',
    cookieString
      .split(';')
      .map(s => s.trim().split('=')[0])
      .filter(Boolean)
  );
  if (Object.keys(raw).length === 0 && !raw._hotkeysParts) return null;

  const prefs = {};
  if (raw._hotkeysParts) {
    const indices = Object.keys(raw._hotkeysParts).sort((a, b) => {
      const na = parseInt(a, 10);
      const nb = parseInt(b, 10);
      if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
      return String(a).localeCompare(String(b));
    });
    console.log(
      '[Hotkeys cookie] Found hotkeys parts:',
      indices,
      'part0 length=',
      raw._hotkeysParts[indices[0]]?.length
    );
    const parts = indices.map(i => raw._hotkeysParts[i]);
    let hotkeysStr = (parts[0] || '') + (parts.slice(1).join('') || '');
    // When hotkeys are split across cookies, the boundary has ..."previousSta" + "ge"... => ..."previousSta""ge"... Remove the duplicate "" so we get ..."previousStage"...
    hotkeysStr = hotkeysStr.replace(/""/g, '');
    try {
      let parsed = JSON.parse(hotkeysStr);
      while (typeof parsed === 'string') {
        parsed = JSON.parse(parsed);
      }
      prefs.hotkeys = Array.isArray(parsed) ? parsed : [];
      // [Hotkeys debug] Cookie hotkeys parsed
      const zoomIn = (prefs.hotkeys || []).find(h => h.commandName === 'scaleUpViewport');
      console.log(
        '[Hotkeys cookie] Parsed hotkeys count:',
        (prefs.hotkeys || []).length,
        'Zoom In (scaleUpViewport) keys:',
        zoomIn?.keys,
        'raw:',
        zoomIn
      );
    } catch (e) {
      console.warn(
        '[Hotkeys cookie] Parse failed:',
        e?.message || e,
        'hotkeysStr length:',
        hotkeysStr?.length
      );
      prefs.hotkeys = [];
    }
  }
  if (raw.globalLineColor != null) prefs.globalLineColor = parseCookieValue(raw.globalLineColor);
  if (raw.globalTextColor != null) prefs.globalTextColor = parseCookieValue(raw.globalTextColor);
  if (raw.globalToolColor != null) prefs.globalToolColor = parseCookieValue(raw.globalToolColor);
  if (raw.mousePreferences != null) {
    try {
      let parsed =
        typeof raw.mousePreferences === 'string'
          ? JSON.parse(raw.mousePreferences)
          : raw.mousePreferences;
      // Cookie may be double-encoded: "{\"bindings\":{\"WindowLevel\":\"Primary\",...}}"
      while (typeof parsed === 'string') {
        parsed = JSON.parse(parsed);
      }
      prefs.mousePreferences = parsed && typeof parsed === 'object' ? parsed : null;
    } catch (_) {
      prefs.mousePreferences = null;
    }
  }
  if (raw.tools != null) {
    try {
      let parsed = typeof raw.tools === 'string' ? JSON.parse(raw.tools) : raw.tools;
      // Cookie may be double-encoded (value stored as JSON string): "[{\"toolId\":...}]"
      while (typeof parsed === 'string') {
        parsed = JSON.parse(parsed);
      }
      prefs.tools = Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
    } catch (_) {
      prefs.tools = [];
    }
  }
  if (raw.windowLevelPresets != null) {
    try {
      prefs.windowLevelPresets =
        typeof raw.windowLevelPresets === 'string'
          ? JSON.parse(raw.windowLevelPresets)
          : raw.windowLevelPresets;
    } catch (_) {
      prefs.windowLevelPresets = raw.windowLevelPresets;
    }
  }
  if (raw.dataSourceFormat != null) prefs.dataSourceFormat = parseCookieValue(raw.dataSourceFormat);

  const hasAny =
    prefs.hotkeys?.length > 0 ||
    prefs.globalLineColor != null ||
    prefs.globalTextColor != null ||
    prefs.globalToolColor != null ||
    (prefs.tools &&
      (Array.isArray(prefs.tools)
        ? prefs.tools.length > 0
        : Object.keys(prefs.tools).length > 0)) ||
    (prefs.mousePreferences && Object.keys(prefs.mousePreferences).length > 0) ||
    prefs.windowLevelPresets != null ||
    prefs.dataSourceFormat != null;
  return hasAny ? prefs : null;
}

// Function to fetch preferences: first from cookies (userPreferences_*), then from API if no cookie data
async function fetchPreferences() {
  if (_preferencesCache !== undefined) {
    return _preferencesCache;
  }
  if (_preferencesPromise) {
    return _preferencesPromise;
  }
  _preferencesPromise = (async () => {
    try {
      const fromCookies = getPreferencesFromCookies();
      if (fromCookies != null) {
        _preferencesCache = fromCookies;
        const zoomIn = (fromCookies.hotkeys || []).find(h => h.commandName === 'scaleUpViewport');
        console.log(
          '[fetchPreferences] Using cookie preferences. Hotkeys count=',
          (fromCookies.hotkeys || []).length,
          'Zoom In keys=',
          zoomIn?.keys
        );
        return fromCookies;
      }

      const token = getTokenFromCookie();
      if (!token) {
        console.warn('No token found in cookie');
        return null;
      }
      const response = await fetch(`${RIS_API_BASE}/api/v1/preferences/getPreferences`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          Token: token,
        },
      });
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();
      _preferencesCache = data;
      return data;
    } catch (error) {
      console.error('Error fetching preferences:', error);
      _preferencesCache = null;
      return null;
    } finally {
      _preferencesPromise = null;
    }
  })();
  return _preferencesPromise;
}

// Optional: clear cache (e.g. after save so next read gets fresh data)
function clearPreferencesCache() {
  _preferencesPromise = null;
  _preferencesCache = undefined;
}

async function savePreferences(payload) {
  try {
    const token = getTokenFromCookie();
    if (!token) {
      console.warn('No token found in cookie');
      return null;
    }
    const response = await fetch(`${RIS_API_BASE}/api/v1/preferences/savePreferences`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Token: token,
      },
      body: JSON.stringify(payload || {}),
    });
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    clearPreferencesCache();
    return await response.json();
  } catch (error) {
    console.error('Error saving preferences:', error);
    return null;
  }
}

function getDefaultDataSourceName() {
  // Prefer cookie value first so initial route uses user preference immediately
  // (avoids stale localStorage selecting a different datasource like wadouri).
  const cookieDataSourceRaw = getCookie('userPreferences_dataSourceFormat');
  const cookieDataSourceParsed = parseCookieValue(cookieDataSourceRaw);
  const cookieDataSource =
    typeof cookieDataSourceParsed === 'string' ? cookieDataSourceParsed.trim() : '';
  if (cookieDataSource) {
    console.log(`Using cookie default data source: ${cookieDataSource}`);
    localStorage.setItem('defaultDataSourceName', cookieDataSource);
    return cookieDataSource;
  }

  // Check localStorage first for cached value
  const cachedDataSource = localStorage.getItem('defaultDataSourceName');
  if (cachedDataSource) {
    console.log(`Using cached default data source: ${cachedDataSource}`);
    return cachedDataSource;
  }
  const defaultName = PACS_INTEGRATION === 'azurepacs' ? 'dicomweb' : 'localviewer-image-jpeg';
  console.log(`Using fallback default data source: ${defaultName}`);
  return defaultName;
}

/**
 * Med-PACS vs Azure clinical DICOMweb sources (dicomweb, localviewer-*, demo).
 * Sample servers (ohif/ohif2/ohif3) and local5000/orthanc/proxy stay in main config.
 */
function getClinicalDicomWebDataSources() {
  if (PACS_INTEGRATION === 'azurepacs') {
    var baseUrl = getAzureDicomV2BaseUrl();
    var token = getAzurePacsToken();
    return [
      {
        namespace: '@ohif/extension-default.dataSourcesModule.dicomweb',
        sourceName: 'dicomweb',
        configuration: {
          friendlyName: 'Azure PACS DICOM v2',
          name: 'azure-pacs-v2',
          wadoUriRoot: baseUrl,
          qidoRoot: baseUrl,
          wadoRoot: baseUrl,
          qidoSupportsIncludeField: true,
          imageRendering: 'wadors',
          thumbnailRendering: 'wadors',
          enableStudyLazyLoad: true,
          supportsFuzzyMatching: true,
          supportsWildcard: true,
          staticWado: false,
          singlepart: 'bulkdata,video',
          bulkDataURI: {
            enabled: true,
            relativeResolution: 'studies',
            transform: url => url.replace('/pixeldata.mp4', '/rendered'),
          },
          omitQuotationForMultipartRequest: false,
          acceptHeader: [
            'multipart/related; type="image/jp2";transfer-syntax=1.2.840.10008.1.2.4.90',
          ],
          isAzureDicomV2: true,
          azureToken: token,
        },
      },
      ...getAzurePacsFrameRetrievalDataSources(),
      {
        namespace: '@ohif/extension-default.dataSourcesModule.dicomweb',
        sourceName: 'localviewer-image-jpeg',
        configuration: {
          friendlyName: 'Azure PACS DICOM v2 (WADO-RS)',
          name: 'azure-pacs-v2-wadors',
          wadoUriRoot: baseUrl,
          qidoRoot: baseUrl,
          wadoRoot: baseUrl,
          qidoSupportsIncludeField: true,
          imageRendering: 'wadors',
          thumbnailRendering: 'wadors',
          enableStudyLazyLoad: true,
          supportsFuzzyMatching: true,
          supportsWildcard: true,
          staticWado: false,
          singlepart: 'bulkdata,video',
          bulkDataURI: {
            enabled: true,
            relativeResolution: 'studies',
            transform: url => url.replace('/pixeldata.mp4', '/rendered'),
          },
          omitQuotationForMultipartRequest: true,
          acceptHeader: '*/*',
          isAzureDicomV2: true,
          azureToken: token,
        },
      },
      {
        namespace: '@ohif/extension-default.dataSourcesModule.dicomweb',
        sourceName: 'localviewer-application-dicom',
        configuration: {
          friendlyName: 'Azure PACS DICOM v2 (WADO-RS)',
          name: 'azure-pacs-v2-wadors',
          wadoUriRoot: baseUrl,
          qidoRoot: baseUrl,
          wadoRoot: baseUrl,
          qidoSupportsIncludeField: true,
          imageRendering: 'wadors',
          thumbnailRendering: 'wadors',
          enableStudyLazyLoad: true,
          supportsFuzzyMatching: true,
          supportsWildcard: true,
          staticWado: false,
          singlepart: 'bulkdata,video',
          bulkDataURI: {
            enabled: true,
            relativeResolution: 'studies',
            transform: url => url.replace('/pixeldata.mp4', '/rendered'),
          },
          omitQuotationForMultipartRequest: true,
          acceptHeader: '*/*',
          isAzureDicomV2: true,
          azureToken: token,
        },
      },
      {
        namespace: '@ohif/extension-default.dataSourcesModule.dicomweb',
        sourceName: 'localviewer-raw-dicom',
        configuration: {
          friendlyName: 'Azure PACS DICOM v2 (WADO-RS)',
          name: 'azure-pacs-v2-wadors',
          wadoUriRoot: baseUrl,
          qidoRoot: baseUrl,
          wadoRoot: baseUrl,
          qidoSupportsIncludeField: true,
          imageRendering: 'wadors',
          thumbnailRendering: 'wadors',
          enableStudyLazyLoad: true,
          supportsFuzzyMatching: true,
          supportsWildcard: true,
          staticWado: false,
          singlepart: 'bulkdata,video',
          bulkDataURI: {
            enabled: true,
            relativeResolution: 'studies',
            transform: url => url.replace('/pixeldata.mp4', '/rendered'),
          },
          omitQuotationForMultipartRequest: true,
          acceptHeader: '*/*',
          isAzureDicomV2: true,
          azureToken: token,
        },
      },
      {
        namespace: '@ohif/extension-default.dataSourcesModule.dicomweb',
        sourceName: 'demo',
        configuration: {
          friendlyName: 'Azure PACS DICOM v2 (Demo)',
          name: 'azure-pacs-v2-demo',
          wadoUriRoot: baseUrl,
          qidoRoot: baseUrl,
          wadoRoot: baseUrl,
          qidoSupportsIncludeField: true,
          imageRendering: 'wadors',
          thumbnailRendering: 'wadors',
          enableStudyLazyLoad: true,
          supportsFuzzyMatching: true,
          supportsWildcard: true,
          staticWado: false,
          singlepart: 'bulkdata,video',
          bulkDataURI: {
            enabled: true,
            relativeResolution: 'studies',
            transform: url => url.replace('/pixeldata.mp4', '/rendered'),
          },
          omitQuotationForMultipartRequest: true,
          acceptHeader: [
            'multipart/related; type="image/jp2";transfer-syntax=1.2.840.10008.1.2.4.90',
          ],
          isAzureDicomV2: true,
          azureToken: token,
          onConfiguration: config => {
            config._demoToken = DEMO_TOKEN;
            return config;
          },
          requestOptions: {},
        },
      },
    ];
  }

  return [
    {
      namespace: '@ohif/extension-default.dataSourcesModule.dicomweb',
      sourceName: 'dicomweb',
      configuration: {
        friendlyName: 'AWS S3 Static wado server',
        name: 'aws',
        wadoUriRoot: MED_PACS_DICOMWEB_API_ROOT,
        qidoRoot: MED_PACS_DICOMWEB_API_ROOT,
        wadoRoot: MED_PACS_DICOMWEB_API_ROOT,
        qidoSupportsIncludeField: false,
        imageRendering: 'wadors',
        thumbnailRendering: 'wadors',
        enableStudyLazyLoad: true,
        supportsFuzzyMatching: false,
        supportsWildcard: true,
        staticWado: true,
        singlepart: 'bulkdata,video',
        bulkDataURI: {
          enabled: true,
          relativeResolution: 'studies',
          transform: url => url.replace('/pixeldata.mp4', '/rendered'),
        },
        omitQuotationForMultipartRequest: true,
      },
    },
    {
      namespace: '@ohif/extension-default.dataSourcesModule.dicomweb',
      sourceName: 'localviewer-image-jpeg',
      configuration: {
        friendlyName: 'AWS S3 Static wado server',
        name: 'aws',
        wadoUriRoot: MED_PACS_DICOMWEB_WADOURI_ROOT,
        qidoRoot: MED_PACS_DICOMWEB_API_ROOT,
        wadoRoot: MED_PACS_DICOMWEB_API_ROOT,
        qidoSupportsIncludeField: true,
        imageRendering: 'wadouri',
        thumbnailRendering: 'wadouri',
        enableStudyLazyLoad: true,
        supportsFuzzyMatching: false,
        supportsWildcard: true,
        staticWado: true,
        singlepart: 'bulkdata,video',
        bulkDataURI: {
          enabled: true,
          relativeResolution: 'studies',
          transform: url => url.replace('/pixeldata.mp4', '/rendered'),
        },
        wadouriTransform: url =>
          url.replace('contentType=application/dicom', 'contentType=image/jpeg'),
        omitQuotationForMultipartRequest: true,
        acceptHeader: '*/*',
      },
    },
    {
      namespace: '@ohif/extension-default.dataSourcesModule.dicomweb',
      sourceName: 'localviewer-application-dicom',
      configuration: {
        friendlyName: 'AWS S3 Static wado server',
        name: 'aws',
        wadoUriRoot: MED_PACS_DICOMWEB_WADOURI_ROOT,
        qidoRoot: MED_PACS_DICOMWEB_API_ROOT,
        wadoRoot: MED_PACS_DICOMWEB_API_ROOT,
        qidoSupportsIncludeField: true,
        imageRendering: 'wadouri',
        thumbnailRendering: 'wadouri',
        enableStudyLazyLoad: true,
        supportsFuzzyMatching: false,
        supportsWildcard: true,
        staticWado: true,
        singlepart: 'bulkdata,video',
        bulkDataURI: {
          enabled: true,
          relativeResolution: 'studies',
          transform: url => url.replace('/pixeldata.mp4', '/rendered'),
        },
        omitQuotationForMultipartRequest: true,
        acceptHeader: '*/*',
      },
    },
    {
      namespace: '@ohif/extension-default.dataSourcesModule.dicomweb',
      sourceName: 'localviewer-raw-dicom',
      configuration: {
        friendlyName: 'Med-PACS raw DICOM (WADO-RS frames)',
        name: 'aws',
        wadoUriRoot: MED_PACS_DICOMWEB_API_ROOT,
        qidoRoot: MED_PACS_DICOMWEB_API_ROOT,
        wadoRoot: MED_PACS_DICOMWEB_API_ROOT,
        qidoSupportsIncludeField: true,
        // Use WADO-RS image retrieval so requests go through /studies/.../series/.../instances/.../frames/{FrameList}.
        imageRendering: 'wadors',
        thumbnailRendering: 'wadors',
        enableStudyLazyLoad: true,
        supportsFuzzyMatching: false,
        supportsWildcard: true,
        staticWado: true,
        singlepart: 'bulkdata,video',
        bulkDataURI: {
          enabled: true,
          relativeResolution: 'studies',
          transform: url => url.replace('/pixeldata.mp4', '/rendered'),
        },
        omitQuotationForMultipartRequest: true,
      },
    },
    {
      namespace: '@ohif/extension-default.dataSourcesModule.dicomweb',
      sourceName: 'demo',
      configuration: {
        friendlyName: 'Demo PACS (Hardcoded Token)',
        name: 'Demo PACS',
        wadoUriRoot: MED_PACS_DICOMWEB_API_ROOT,
        qidoRoot: MED_PACS_DICOMWEB_API_ROOT,
        wadoRoot: MED_PACS_DICOMWEB_API_ROOT,
        qidoSupportsIncludeField: false,
        imageRendering: 'wadors',
        thumbnailRendering: 'wadors',
        enableStudyLazyLoad: true,
        supportsFuzzyMatching: false,
        supportsWildcard: true,
        staticWado: true,
        singlepart: 'bulkdata,video',
        bulkDataURI: {
          enabled: true,
          relativeResolution: 'studies',
          transform: url => url.replace('/pixeldata.mp4', '/rendered'),
        },
        omitQuotationForMultipartRequest: true,
        onConfiguration: config => {
          config._demoToken = DEMO_TOKEN;
          return config;
        },
        requestOptions: {},
      },
    },
  ];
}

async function updateDefaultDataSourceName() {
  try {
    const preferences = await fetchPreferences();
    console.log('preferences', preferences.dataSourceFormat);
    if (preferences && preferences.dataSourceFormat) {
      const newDataSource = preferences.dataSourceFormat;
      console.log(`Updating default data source to: ${newDataSource}`);
      // Update localStorage cache
      localStorage.setItem('defaultDataSourceName', newDataSource);
      // Update config if it exists
      if (window['config']) {
        window['config'].defaultDataSourceName = newDataSource;
      }
      return newDataSource;
    }
  } catch (e) {
    console.log('Error fetching preferences:', e);
  }
  return null;
}

/** @type {AppTypes.Config} */
// @ts-expect-error - Adding custom property to window
window.config = {
  name: 'config/default.js',
  isDev,
  routerBasename: null,
  // whiteLabeling: {},
  extensions: [],
  modes: [],
  customizationService: {},
  showStudyList: true,
  // Report: createreport base — local dev: createReportAppBaseUrl. Production: createReportAppBaseUrlProduction or risWorklistUrl origin (used with viewDicomImg dicomData._id).
  createReportAppBaseUrl: isDev ? RIS_DEV_PORTAL_ORIGIN : undefined,
  createReportAppBaseUrlProduction: `${RIS_PORTAL_ORIGIN}`, // optional; default = new URL(risWorklistUrl).origin
  // RIS redirects (see platform/core risEnvironmentDefaults for build-time defaults)
  redirectRootToRis: true,
  redirectToRisOn401: true,
  // Optional: override targets (else risWorklistUrl + built-in fallbacks)
  // risRootRedirectUrl: `${RIS_PORTAL_ORIGIN}/worklist`,
  // risAuthRedirectUrl: `${RIS_PORTAL_ORIGIN}/login`,
  risWorklistUrl: `${RIS_PORTAL_ORIGIN}/worklist`,
  /** “← Report” → POST viewDicomImg, then Synapse `/createreport/{dicomData._id}/{studyUID}?tempId=`. */
  risReportUseViewDicomApi: true,
  risApiBase: RIS_API_BASE,
  // SR text push endpoint (used by SR text viewport "Send SR Text to RIS" button)
  risSrTextUploadPath: '/api/v1/structured-report/send-text',
  keyImagesUploadUrl: `${RIS_API_BASE}/api/v1/key-images/upload`,
  // Pre-encoded Basic token (Authorization: Basic <token>). Same pattern as DEMO_TOKEN / DicomWeb.
  keyImagesBasicAuthToken: DEMO_TOKEN,
  keyImagesAuthorization: `Basic ${DEMO_TOKEN}`,
  // Legacy user:pass (runtime btoa) — prefer keyImagesBasicAuthToken above.
  // keyImagesBasicAuth: 'user:pass',
  // risReportUrl: `${RIS_PORTAL_ORIGIN}/report`,
  // some windows systems have issues with more than 3 web workers
  maxNumberOfWebWorkers: 3,
  // below flag is for performance reasons, but it might not work for all servers
  showWarningMessageForCrossOrigin: true,
  showCPUFallbackMessage: true,
  showLoadingIndicator: true,
  experimentalStudyBrowserSort: false,
  strictZSpacingForVolumeViewport: true,
  groupEnabledModesFirst: true,
  allowMultiSelectExport: false,
  // Load only first series metadata on init; load other series when user clicks (requires enableStudyLazyLoad on data source).
  loadSeriesMetadataOnDemand: true,
  // When loadSeriesMetadataOnDemand is true, load this many series in background so thumbnails appear (0 = none).
  loadSeriesMetadataOnDemandBackgroundCount: 5,
  studyPrefetcher: {
    enabled: true,
    maxNumPrefetchRequests: 3,
    maxImagesPerDisplaySetToPrefetch: 30, // Cap prefetch per series to reduce API calls (e.g. 464-instance series)
    prefetchAllSeries: false,
  },
  maxNumRequests: {
    interaction: 100,
    thumbnail: 75,
    // Prefetch number is dependent on the http protocol. For http 2 or
    // above, the number of requests can be go a lot higher.
    prefetch: 25,
  },
  showErrorDetails: 'dev', // 'always' | 'dev' (no full-screen overlay in production) | 'production'
  // When PACS returns HTTP 406 (e.g. US rejecting JPEG WADO-URI), switch data source and prompt page restart.
  dataSource406Fallback: {
    enabled: true,
    fallbackMap: {
      'localviewer-image-jpeg': 'localviewer-raw-dicom',
      'localviewer-application-dicom': 'localviewer-raw-dicom',
    },
  },
  // RIS → viewer: postMessage LOAD_STUDY to reuse one tab (SPA navigate, no new tab / full reload).
  // Set enabled true and list your RIS origins (exact event.origin strings).
  risPostMessage: {
    enabled: false,
    allowedOrigins: [
      'http://localhost:5173',
      RIS_DEV_PORTAL_ORIGIN,
      RIS_PROD_PORTAL_ORIGIN,
      RIS_PORTAL_ORIGIN,
      // 'https://your-ris-production-origin',
    ],
  },
  // filterQueryParam: false,
  // Defines multi-monitor layouts
  multimonitor: [
    {
      id: 'split',
      test: ({ multimonitor }) => multimonitor === 'split',
      screens: [
        {
          id: 'ohif0',
          screen: null,
          location: {
            screen: 0,
            width: 0.5,
            height: 1,
            left: 0,
            top: 0,
          },
          options: 'location=no,menubar=no,scrollbars=no,status=no,titlebar=no',
        },
        {
          id: 'ohif1',
          screen: null,
          location: {
            width: 0.5,
            height: 1,
            left: 0.5,
            top: 0,
          },
          options: 'location=no,menubar=no,scrollbars=no,status=no,titlebar=no',
        },
      ],
    },

    {
      id: '2',
      test: ({ multimonitor }) => multimonitor === '2',
      screens: [
        {
          id: 'ohif0',
          screen: 0,
          location: {
            width: 1,
            height: 1,
            left: 0,
            top: 0,
          },
          options: 'fullscreen=yes,location=no,menubar=no,scrollbars=no,status=no,titlebar=no',
        },
        {
          id: 'ohif1',
          screen: 1,
          location: {
            width: 1,
            height: 1,
            left: 0,
            top: 0,
          },
          options: 'fullscreen=yes,location=no,menubar=no,scrollbars=no,status=no,titlebar=no',
        },
      ],
    },
  ],
  defaultDataSourceName: getDefaultDataSourceName(), // synchronous with localStorage cache
  pacsIntegration: PACS_INTEGRATION,
  azurePacsPreferCookieAuth: AZURE_PACS_PREFER_COOKIE_AUTH,
  // Cookie-based authentication configuration
  // Token (or patientToken) is read from cookies and passed in all API request headers, including PACS (study, series, instance)
  cookieAuth: {
    enabled: true, // Set to false to disable cookie-based auth
    cookieName: 'token', // Primary cookie for token (clinician app)
    patientTokenCookieName: 'patientToken', // Fallback cookie for patient-facing app; either token or patientToken is used for PACS API
  },
  /* Dynamic config allows user to pass "configUrl" query string this allows to load config without recompiling application. The regex will ensure valid configuration source */
  // dangerouslyUseDynamicConfig: {
  //   enabled: true,
  //   // regex will ensure valid configuration source and default is /.*/ which matches any character. To use this, setup your own regex to choose a specific source of configuration only.
  //   // Example 1, to allow numbers and letters in an absolute or sub-path only.
  //   // regex: /(0-9A-Za-z.]+)(\/[0-9A-Za-z.]+)*/
  //   // Example 2, to restricts to either hosptial.com or othersite.com.
  //   // regex: /(https:\/\/hospital.com(\/[0-9A-Za-z.]+)*)|(https:\/\/othersite.com(\/[0-9A-Za-z.]+)*)/
  //   regex: /.*/,
  // },
  dataSources: [
    {
      namespace: '@ohif/extension-default.dataSourcesModule.dicomweb',
      sourceName: 'ohif',
      configuration: {
        friendlyName: 'AWS S3 Static wado server',
        name: 'aws',
        wadoUriRoot: 'https://d14fa38qiwhyfd.cloudfront.net/dicomweb',
        qidoRoot: 'https://d14fa38qiwhyfd.cloudfront.net/dicomweb',
        wadoRoot: 'https://d14fa38qiwhyfd.cloudfront.net/dicomweb',
        qidoSupportsIncludeField: false,
        imageRendering: 'wadors',
        thumbnailRendering: 'wadors',
        enableStudyLazyLoad: true,
        supportsFuzzyMatching: true,
        supportsWildcard: false,
        staticWado: true,
        singlepart: 'bulkdata,video',
        // whether the data source should use retrieveBulkData to grab metadata,
        // and in case of relative path, what would it be relative to, options
        // are in the series level or study level (some servers like series some study)
        bulkDataURI: {
          enabled: true,
          relativeResolution: 'studies',
          transform: url => url.replace('/pixeldata.mp4', '/rendered'),
        },
        omitQuotationForMultipartRequest: true,
        // acceptHeader: 'multipart/related; type="image/jpeg"; transfer-syntax=*',
      },
    },

    {
      namespace: '@ohif/extension-default.dataSourcesModule.dicomweb',
      sourceName: 'ohif2',
      configuration: {
        friendlyName: 'AWS S3 Static wado secondary server',
        name: 'aws',
        wadoUriRoot: 'https://dd14fa38qiwhyfd.cloudfront.net/dicomweb',
        qidoRoot: 'https://dd14fa38qiwhyfd.cloudfront.net/dicomweb',
        wadoRoot: 'https://dd14fa38qiwhyfd.cloudfront.net/dicomweb',
        qidoSupportsIncludeField: false,
        supportsReject: false,
        imageRendering: 'wadors',
        thumbnailRendering: 'wadors',
        enableStudyLazyLoad: true,
        supportsFuzzyMatching: false,
        supportsWildcard: true,
        staticWado: true,
        singlepart: 'bulkdata,video',
        // whether the data source should use retrieveBulkData to grab metadata,
        // and in case of relative path, what would it be relative to, options
        // are in the series level or study level (some servers like series some study)
        bulkDataURI: {
          enabled: true,
          relativeResolution: 'studies',
        },
        omitQuotationForMultipartRequest: true,
      },
    },
    {
      namespace: '@ohif/extension-default.dataSourcesModule.dicomweb',
      sourceName: 'ohif3',
      configuration: {
        friendlyName: 'AWS S3 Static wado secondary server',
        name: 'aws',
        wadoUriRoot: 'https://d3t6nz73ql33tx.cloudfront.net/dicomweb',
        qidoRoot: 'https://d3t6nz73ql33tx.cloudfront.net/dicomweb',
        wadoRoot: 'https://d3t6nz73ql33tx.cloudfront.net/dicomweb',
        qidoSupportsIncludeField: false,
        supportsReject: false,
        imageRendering: 'wadors',
        thumbnailRendering: 'wadors',
        enableStudyLazyLoad: true,
        supportsFuzzyMatching: false,
        supportsWildcard: true,
        staticWado: true,
        singlepart: 'bulkdata,video',
        // whether the data source should use retrieveBulkData to grab metadata,
        // and in case of relative path, what would it be relative to, options
        // are in the series level or study level (some servers like series some study)
        bulkDataURI: {
          enabled: true,
          relativeResolution: 'studies',
        },
        omitQuotationForMultipartRequest: true,
      },
    },

    ...getClinicalDicomWebDataSources(),

    {
      namespace: '@ohif/extension-default.dataSourcesModule.dicomweb',
      sourceName: 'local5000',
      configuration: {
        friendlyName: 'Static WADO Local Data',
        name: 'DCM4CHEE',
        qidoRoot: 'http://localhost:5000/dicomweb',
        wadoRoot: 'http://localhost:5000/dicomweb',
        qidoSupportsIncludeField: false,
        supportsReject: true,
        supportsStow: true,
        imageRendering: 'wadors',
        thumbnailRendering: 'wadors',
        enableStudyLazyLoad: true,
        supportsFuzzyMatching: false,
        supportsWildcard: true,
        staticWado: true,
        singlepart: 'video',
        bulkDataURI: {
          enabled: true,
          relativeResolution: 'studies',
        },
      },
    },
    {
      namespace: '@ohif/extension-default.dataSourcesModule.dicomweb',
      sourceName: 'orthanc',
      configuration: {
        friendlyName: 'local Orthanc DICOMWeb Server',
        name: 'DCM4CHEE',
        wadoUriRoot: 'http://localhost/pacs/dicom-web',
        qidoRoot: 'http://localhost/pacs/dicom-web',
        wadoRoot: 'http://localhost/pacs/dicom-web',
        qidoSupportsIncludeField: true,
        supportsReject: true,
        dicomUploadEnabled: true,
        imageRendering: 'wadors',
        thumbnailRendering: 'wadors',
        enableStudyLazyLoad: true,
        supportsFuzzyMatching: true,
        supportsWildcard: true,
        omitQuotationForMultipartRequest: true,
        bulkDataURI: {
          enabled: true,
          // This is an example config that can be used to fix the retrieve URL
          // where it has the wrong prefix (eg a canned prefix).  It is better to
          // just use the correct prefix out of the box, but that is sometimes hard
          // when URLs go through several systems.
          // Example URLS are:
          // "BulkDataURI" : "http://localhost/dicom-web/studies/1.2.276.0.7230010.3.1.2.2344313775.14992.1458058363.6979/series/1.2.276.0.7230010.3.1.3.1901948703.36080.1484835349.617/instances/1.2.276.0.7230010.3.1.4.1901948703.36080.1484835349.618/bulk/00420011",
          // when running on http://localhost:3003 with no server running on localhost.  This can be corrected to:
          // /orthanc/dicom-web/studies/1.2.276.0.7230010.3.1.2.2344313775.14992.1458058363.6979/series/1.2.276.0.7230010.3.1.3.1901948703.36080.1484835349.617/instances/1.2.276.0.7230010.3.1.4.1901948703.36080.1484835349.618/bulk/00420011
          // which is a valid relative URL, and will result in using the http://localhost:3003/orthanc/.... path
          // startsWith: 'http://localhost/',
          // prefixWith: '/orthanc/',
        },
      },
    },

    {
      namespace: '@ohif/extension-default.dataSourcesModule.dicomwebproxy',
      sourceName: 'dicomwebproxy',
      configuration: {
        friendlyName: 'dicomweb delegating proxy',
        name: 'dicomwebproxy',
      },
    },
    {
      namespace: '@ohif/extension-default.dataSourcesModule.dicomjson',
      sourceName: 'dicomjson',
      configuration: {
        friendlyName: 'dicom json',
        name: 'json',
      },
    },
    {
      namespace: '@ohif/extension-default.dataSourcesModule.dicomlocal',
      sourceName: 'dicomlocal',
      configuration: {
        friendlyName: 'dicom local',
      },
    },
  ],
  httpErrorHandler: error => {
    // dicomweb-client rejects with Error('request failed') + status, request (XHR), response
    // @ts-expect-error - augmented error from dicomweb-client
    const status = error?.status ?? error?.statusCode;
    // @ts-expect-error
    const xhr = error?.request;
    const url =
      (xhr && (xhr.responseURL || xhr._url || xhr.url)) || '(see Network tab for failing URL)';
    if (status === 404) {
      console.warn('[DICOMweb] Instance not found (suppressed in viewer)', {
        status,
        url,
        message: error?.message,
      });
      return;
    }
    console.error('[DICOMweb] request failed', {
      status,
      url,
      message: error?.message,
    });
    if (status === 401 || status === 403) {
      console.warn(
        '[DICOMweb] Auth rejected — check cookie token / Basic auth for your PACS (and ShortCode share link if used).'
      );
    } else if (status === 0 || status == null) {
      console.warn(
        '[DICOMweb] Status 0 / unknown — often CORS, blocked network, wrong HTTPS, or adblock.'
      );
    } else if (status === 406) {
      console.warn(
        '[DICOMweb] Not Acceptable — PACS rejected the requested representation (e.g. JPEG for ultrasound). Switching data source if configured.'
      );
      if (typeof window !== 'undefined' && typeof window.handleDataSource406 === 'function') {
        window.handleDataSource406({ source: 'config-http-error-handler' });
      }
    }
  },
  // segmentation: {
  //   segmentLabel: {
  //     enabledByDefault: true,
  //     labelColor: [255, 255, 0, 1], // must be an array
  //     hoverTimeout: 1,
  //     background: 'rgba(100, 100, 100, 0.5)', // can be any valid css color
  //   },
  // },
  // whiteLabeling: {
  //   createLogoComponentFn: function (React) {
  //     return React.createElement(
  //       'a',
  //       {
  //         target: '_self',
  //         rel: 'noopener noreferrer',
  //         className: 'text-purple-600 line-through',
  //         href: '_X___IDC__LOGO__LINK___Y_',
  //       },
  //       React.createElement('img', {
  //         src: './Logo.svg',
  //         className: 'w-14 h-14',
  //       })
  //     );
  //   },
  // },
};

// Update defaultDataSourceName asynchronously and cache it
updateDefaultDataSourceName().catch(error => {
  console.error('Failed to update default data source name:', error);
});

// One-time cleanup: older builds stored ohif406ActiveDataSource and redirected every visit.
try {
  if (typeof localStorage !== 'undefined') {
    localStorage.removeItem('ohif406ActiveDataSource');
  }
} catch (_) {}

// Expose preferences API for Settings UI (single shared fetch; response cached for app)
if (typeof window !== 'undefined') {
  window.fetchPreferences = fetchPreferences;
  window.savePreferences = savePreferences;
  window.clearPreferencesCache = clearPreferencesCache;
  window.getPreferencesFromCookies = getPreferencesFromCookies;
}
