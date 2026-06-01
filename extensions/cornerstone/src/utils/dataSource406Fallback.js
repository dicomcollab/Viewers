/**
 * When PACS returns HTTP 406 (e.g. US studies rejecting JPEG WADO-URI), switch to a
 * configured fallback data source and navigate to that route so image IDs reload.
 *
 * Kept free of @ohif/core imports (same rationale as risRedirectConfig.js).
 */

const SESSION_FLAG = 'ohif406FallbackInProgress';
const ACTIVE_DS_KEY = 'ohif406ActiveDataSource';
const OVERLAY_ID = 'ohif-406-fallback-overlay';

function getAppConfig() {
  return (typeof window !== 'undefined' && window.config) || {};
}

function get406FallbackConfig() {
  return getAppConfig().dataSource406Fallback || {};
}

/**
 * Parse active clinical data source from viewer route:
 * /viewer/{source} or /external/viewer/{source}
 */
export function getDataSourceFromUrl() {
  if (typeof window === 'undefined') {
    return null;
  }
  const path = window.location.pathname || '';
  const match = path.match(/(?:^|\/)viewer\/([^/]+)/i);
  return match ? decodeURIComponent(match[1]) : null;
}

/**
 * Build a full navigation URL that uses the fallback data source in the route path.
 * @param {string} fallbackSource
 * @param {string|null|undefined} currentSource
 */
export function buildFallbackNavigationUrl(fallbackSource, currentSource) {
  if (typeof window === 'undefined' || !fallbackSource) {
    return null;
  }

  const search = window.location.search || '';
  const hash = window.location.hash || '';
  let path = window.location.pathname || '';
  const fallbackMap = get406FallbackConfig().fallbackMap || {};
  const replaceCandidates = new Set(
    [currentSource, getDataSourceFromUrl(), ...Object.keys(fallbackMap)].filter(Boolean)
  );

  for (const fromDs of replaceCandidates) {
    const segment = `/${fromDs}`;
    if (path.includes(segment)) {
      return `${path.replace(segment, `/${fallbackSource}`)}${search}${hash}`;
    }
  }

  if (/\/external\/viewer\/?$/i.test(path)) {
    return `${path.replace(/\/?$/, '')}/${fallbackSource}${search}${hash}`;
  }
  if (/\/viewer\/?$/i.test(path)) {
    return `${path.replace(/\/?$/, '')}/${fallbackSource}${search}${hash}`;
  }

  const viewerMatch = path.match(/^(.*\/viewer)(\/.*)?$/i);
  if (viewerMatch) {
    const base = viewerMatch[1];
    const rest = viewerMatch[2] || '';
    const restSegment = rest.replace(/^\//, '').split('/')[0];
    if (!restSegment || replaceCandidates.has(restSegment)) {
      return `${base}/${fallbackSource}${search}${hash}`;
    }
  }

  const separator = path.endsWith('/') ? '' : '/';
  return `${path}${separator}${fallbackSource}${search}${hash}`;
}

function persist406FallbackState(fallbackSource) {
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(ACTIVE_DS_KEY, fallbackSource);
    localStorage.setItem('defaultDataSourceName', fallbackSource);
  }

  if (typeof window !== 'undefined') {
    window.config = window.config || {};
    window.config.defaultDataSourceName = fallbackSource;

    if (typeof window.apply406DataSourcePreferenceOverride === 'function') {
      window.apply406DataSourcePreferenceOverride(fallbackSource);
    }

    if (typeof window.savePreferences === 'function') {
      window.savePreferences({ dataSourceFormat: fallbackSource }).catch(() => {});
    }
  }
}

/**
 * Hard navigation to the fallback data source route (not a soft reload).
 * @param {string} currentSource
 * @param {string} fallbackSource
 */
export function navigateTo406FallbackDataSource(currentSource, fallbackSource) {
  const targetUrl = buildFallbackNavigationUrl(fallbackSource, currentSource);
  if (!targetUrl) {
    window.location.reload();
    return;
  }

  if (typeof sessionStorage !== 'undefined') {
    sessionStorage.removeItem(SESSION_FLAG);
  }

  console.warn(`[406 fallback] Navigating to ${targetUrl}`);
  window.location.replace(targetUrl);
}

function getFriendlyDataSourceLabel(sourceName) {
  const cfg = getAppConfig();
  const sources = cfg.dataSources || [];
  const found = sources.find(ds => ds.sourceName === sourceName);
  return found?.configuration?.friendlyName || sourceName;
}

function show406ReloadOverlay(currentSource, fallbackSource) {
  if (typeof document === 'undefined') {
    return;
  }
  if (document.getElementById(OVERLAY_ID)) {
    return;
  }

  const currentLabel = getFriendlyDataSourceLabel(currentSource);
  const fallbackLabel = getFriendlyDataSourceLabel(fallbackSource);

  const overlay = document.createElement('div');
  overlay.id = OVERLAY_ID;
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.style.cssText =
    'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,0.75);display:flex;align-items:center;justify-content:center;padding:16px;';

  const box = document.createElement('div');
  box.style.cssText =
    'background:#111827;color:#f9fafb;padding:24px;border-radius:10px;max-width:520px;width:100%;box-shadow:0 20px 40px rgba(0,0,0,0.45);font-family:system-ui,-apple-system,sans-serif;line-height:1.5;';

  const title = document.createElement('h2');
  title.textContent = 'Image format not supported';
  title.style.cssText = 'margin:0 0 12px;font-size:20px;font-weight:600;';

  const p1 = document.createElement('p');
  p1.style.margin = '0 0 12px';
  p1.textContent =
    'The PACS rejected the current image request (HTTP 406 Not Acceptable). Some studies — for example ultrasound — only support WADO or raw DICOM, not JPEG thumbnails.';

  const p2 = document.createElement('p');
  p2.style.margin = '0 0 16px';
  p2.innerHTML = `The viewer will switch from <strong>${currentLabel}</strong> to <strong>${fallbackLabel}</strong>. Please restart to load images with the alternate format.`;

  const actions = document.createElement('div');
  actions.style.cssText = 'display:flex;gap:12px;justify-content:flex-end;';

  const reloadBtn = document.createElement('button');
  reloadBtn.type = 'button';
  reloadBtn.textContent = 'Restart now';
  reloadBtn.style.cssText =
    'padding:10px 18px;border:none;border-radius:6px;background:#2563eb;color:#fff;font-size:14px;font-weight:600;cursor:pointer;';
  reloadBtn.onclick = () => {
    navigateTo406FallbackDataSource(currentSource, fallbackSource);
  };

  actions.appendChild(reloadBtn);
  box.appendChild(title);
  box.appendChild(p1);
  box.appendChild(p2);
  box.appendChild(actions);
  overlay.appendChild(box);
  document.body.appendChild(overlay);
}

/**
 * Early boot redirect when a reload lands before React (backup for bookmark/history reload).
 */
export function apply406FallbackRouteRedirect() {
  const cfg = get406FallbackConfig();
  if (!cfg.enabled || typeof window === 'undefined') {
    return;
  }

  const fallbackSource =
    (typeof localStorage !== 'undefined' && localStorage.getItem(ACTIVE_DS_KEY)) ||
    (typeof localStorage !== 'undefined' && localStorage.getItem('defaultDataSourceName'));

  if (!fallbackSource) {
    return;
  }

  const currentSource = getDataSourceFromUrl();
  const pending =
    typeof sessionStorage !== 'undefined' && sessionStorage.getItem(SESSION_FLAG) === '1';

  if (!pending && currentSource === fallbackSource) {
    return;
  }

  if (!pending && !currentSource) {
    return;
  }

  const targetUrl = buildFallbackNavigationUrl(fallbackSource, currentSource);
  const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;

  if (typeof sessionStorage !== 'undefined') {
    sessionStorage.removeItem(SESSION_FLAG);
  }

  if (targetUrl && targetUrl !== currentUrl) {
    window.location.replace(targetUrl);
  }
}

/**
 * @param {{ currentSource?: string, source?: string }} [options]
 * @returns {boolean} true when fallback was triggered
 */
export function handleDataSource406(options = {}) {
  const cfg = get406FallbackConfig();
  if (!cfg.enabled) {
    return false;
  }

  if (typeof sessionStorage !== 'undefined' && sessionStorage.getItem(SESSION_FLAG) === '1') {
    return true;
  }

  const appConfig = getAppConfig();
  const currentSource =
    options.currentSource ||
    getDataSourceFromUrl() ||
    appConfig.defaultDataSourceName ||
    (typeof localStorage !== 'undefined' ? localStorage.getItem('defaultDataSourceName') : null);

  const fallbackMap = cfg.fallbackMap || {};
  const fallbackSource = currentSource ? fallbackMap[currentSource] : null;

  if (!fallbackSource || fallbackSource === currentSource) {
    return false;
  }

  if (typeof sessionStorage !== 'undefined') {
    sessionStorage.setItem(SESSION_FLAG, '1');
  }

  persist406FallbackState(fallbackSource);

  console.warn(
    `[406 fallback] PACS rejected format for "${currentSource}" — switching to "${fallbackSource}". Restart required.`
  );

  show406ReloadOverlay(currentSource, fallbackSource);
  return true;
}

/**
 * @param {XMLHttpRequest} _xhr
 * @param {(reason?: unknown) => void} reject
 * @returns {boolean}
 */
export function handleJpegLoader406(_xhr, reject) {
  const handled = handleDataSource406({ source: 'jpeg-loader' });
  if (handled) {
    reject(
      new Error(
        'HTTP 406: Not Acceptable — restart the page to load images with an alternate PACS format.'
      )
    );
    return true;
  }
  return false;
}

export function get406ActiveDataSourceName() {
  if (typeof localStorage === 'undefined') {
    return null;
  }
  return localStorage.getItem(ACTIVE_DS_KEY);
}
