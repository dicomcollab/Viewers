/**
 * When PACS returns HTTP 406 (e.g. US studies rejecting JPEG WADO-URI), offer a one-time
 * switch to a fallback data source only after the user clicks "Restart now".
 *
 * Does not change global preferences or redirect on normal visits.
 */

const SESSION_FLAG = 'ohif406FallbackInProgress';
const SESSION_TARGET = 'ohif406FallbackTarget';
const OVERLAY_ID = 'ohif-406-fallback-overlay';
const OVERLAY_SHOWN_KEY = 'ohif406OverlayShown';

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

/**
 * Navigate to the fallback route. Called only from the user "Restart now" action.
 */
export function navigateTo406FallbackDataSource(currentSource, fallbackSource) {
  const targetUrl = buildFallbackNavigationUrl(fallbackSource, currentSource);
  if (!targetUrl) {
    console.warn('[406 fallback] Could not build fallback URL');
    return;
  }

  if (typeof sessionStorage !== 'undefined') {
    sessionStorage.removeItem(SESSION_FLAG);
    sessionStorage.removeItem(SESSION_TARGET);
    sessionStorage.removeItem(OVERLAY_SHOWN_KEY);
  }

  console.warn(`[406 fallback] User restart — navigating to ${targetUrl}`);
  window.location.replace(targetUrl);
}

function show406ReloadOverlay(currentSource, fallbackSource) {
  if (typeof document === 'undefined') {
    return;
  }
  if (document.getElementById(OVERLAY_ID)) {
    return;
  }

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
  title.textContent = 'Cannot display images';
  title.style.cssText = 'margin:0 0 12px;font-size:20px;font-weight:600;';

  const message = document.createElement('p');
  message.style.margin = '0 0 20px';
  message.textContent =
    'These images cannot be displayed in the current format. Tap Restart to change the image source and view this study.';

  const actions = document.createElement('div');
  actions.style.cssText = 'display:flex;gap:12px;justify-content:flex-end;';

  const reloadBtn = document.createElement('button');
  reloadBtn.type = 'button';
  reloadBtn.textContent = 'Restart';
  reloadBtn.style.cssText =
    'padding:10px 18px;border:none;border-radius:6px;background:#2563eb;color:#fff;font-size:14px;font-weight:600;cursor:pointer;';
  reloadBtn.onclick = () => {
    navigateTo406FallbackDataSource(currentSource, fallbackSource);
  };

  actions.appendChild(reloadBtn);
  box.appendChild(title);
  box.appendChild(message);
  box.appendChild(actions);
  overlay.appendChild(box);
  document.body.appendChild(overlay);
}

function isFallbackDataSourceName(sourceName) {
  if (!sourceName) {
    return false;
  }
  const fallbackMap = get406FallbackConfig().fallbackMap || {};
  return Object.values(fallbackMap).includes(sourceName);
}

/**
 * @param {{ currentSource?: string, source?: string }} [options]
 * @returns {boolean} true when fallback overlay was shown (or already pending)
 */
export function handleDataSource406(options = {}) {
  const cfg = get406FallbackConfig();
  if (!cfg.enabled) {
    return false;
  }

  const currentSource =
    options.currentSource ||
    getDataSourceFromUrl() ||
    getAppConfig().defaultDataSourceName ||
    null;

  // Already on a fallback route — do not loop or redirect globally.
  if (isFallbackDataSourceName(currentSource)) {
    return false;
  }

  if (typeof sessionStorage !== 'undefined') {
    if (sessionStorage.getItem(OVERLAY_SHOWN_KEY) === '1') {
      return true;
    }
  }

  const fallbackMap = cfg.fallbackMap || {};
  const fallbackSource = currentSource ? fallbackMap[currentSource] : null;

  if (!fallbackSource || fallbackSource === currentSource) {
    return false;
  }

  if (typeof sessionStorage !== 'undefined') {
    sessionStorage.setItem(SESSION_FLAG, '1');
    sessionStorage.setItem(SESSION_TARGET, fallbackSource);
    sessionStorage.setItem(OVERLAY_SHOWN_KEY, '1');
  }

  console.warn(
    `[406 fallback] PACS rejected format for "${currentSource}". User may restart with "${fallbackSource}".`
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
        'HTTP 406: Not Acceptable — click Restart to load images with an alternate PACS format.'
      )
    );
    return true;
  }
  return false;
}

/** Remove legacy keys that caused permanent redirects (one-time cleanup). */
export function clear406FallbackPersistence() {
  if (typeof localStorage !== 'undefined') {
    localStorage.removeItem('ohif406ActiveDataSource');
  }
  if (typeof sessionStorage !== 'undefined') {
    sessionStorage.removeItem(SESSION_FLAG);
    sessionStorage.removeItem(SESSION_TARGET);
    sessionStorage.removeItem(OVERLAY_SHOWN_KEY);
  }
}
