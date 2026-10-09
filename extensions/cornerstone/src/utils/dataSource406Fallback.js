/**
 * When PACS rejects the requested image format for a study (HTTP 406 / 415, e.g. an
 * ultrasound clip that cannot be served as image/jpeg), tell the user which view is
 * not supported and offer to switch to the original data source.
 *
 * The switch is per study URL only; the user's saved data source preference is not changed.
 */

const SESSION_FLAG = 'ohif406FallbackInProgress';
const SESSION_TARGET = 'ohif406FallbackTarget';
const OVERLAY_ID = 'ohif-406-fallback-overlay';
const LEGACY_OVERLAY_SHOWN_KEY = 'ohif406OverlayShown';
const PROMPT_SHOWN_KEY_PREFIX = 'ohifUnsupportedFormatPrompt:';

const UNSUPPORTED_FORMAT_STATUSES = new Set([406, 415]);

export const DEFAULT_DATA_SOURCE_FORMAT_LABELS = {
  'localviewer-image-jpeg': 'Quick Preview (Standard Image)',
  'localviewer-application-dicom': 'Diagnostic View (Full DICOM Data)',
  'localviewer-raw-dicom': 'Advanced View (Detailed DICOM Layers)',
  'localviewer-original-dicom': 'Original Quality (Compressed DICOM)',
  'frame-multipart-octet-wildcard': 'Original Quality (Compressed DICOM)',
};

function getAppConfig() {
  return (typeof window !== 'undefined' && window.config) || {};
}

function get406FallbackConfig() {
  return getAppConfig().dataSource406Fallback || {};
}

export function isUnsupportedFormatStatus(status) {
  return UNSUPPORTED_FORMAT_STATUSES.has(Number(status));
}

export function getDataSourceFormatLabel(sourceName) {
  if (!sourceName) {
    return 'the current image format';
  }
  const labels = {
    ...DEFAULT_DATA_SOURCE_FORMAT_LABELS,
    ...(getAppConfig().dataSourceFormatLabels || {}),
  };
  return labels[sourceName] || sourceName;
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

function getPromptShownKey() {
  if (typeof window === 'undefined') {
    return PROMPT_SHOWN_KEY_PREFIX;
  }
  return `${PROMPT_SHOWN_KEY_PREFIX}${window.location.pathname}${window.location.search}`;
}

/**
 * Navigate to the fallback route. Called only from the user "Switch to …" action.
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
  }

  console.warn(`[406 fallback] User switched data source — navigating to ${targetUrl}`);
  window.location.replace(targetUrl);
}

function closeOverlay() {
  document.getElementById(OVERLAY_ID)?.remove();
}

function createButton(text, primary) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = text;
  button.style.cssText = primary
    ? 'padding:10px 18px;border:none;border-radius:6px;background:#2563eb;color:#fff;font-size:14px;font-weight:600;cursor:pointer;'
    : 'padding:10px 18px;border:1px solid #4b5563;border-radius:6px;background:transparent;color:#e5e7eb;font-size:14px;font-weight:500;cursor:pointer;';
  return button;
}

function show406ReloadOverlay(currentSource, fallbackSource) {
  if (typeof document === 'undefined') {
    return;
  }
  if (document.getElementById(OVERLAY_ID)) {
    return;
  }

  const currentLabel = getDataSourceFormatLabel(currentSource);
  const fallbackLabel = getDataSourceFormatLabel(fallbackSource);

  const overlay = document.createElement('div');
  overlay.id = OVERLAY_ID;
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.style.cssText =
    'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,0.75);display:flex;align-items:center;justify-content:center;padding:16px;';

  const box = document.createElement('div');
  box.style.cssText =
    'background:#111827;color:#f9fafb;padding:24px;border-radius:10px;max-width:540px;width:100%;box-shadow:0 20px 40px rgba(0,0,0,0.45);font-family:system-ui,-apple-system,sans-serif;line-height:1.5;';

  const title = document.createElement('h2');
  title.textContent = `${currentLabel} is not supported for this study`;
  title.style.cssText = 'margin:0 0 12px;font-size:20px;font-weight:600;';

  const message = document.createElement('p');
  message.style.margin = '0 0 8px';
  message.textContent = `The images in this study cannot be displayed with ${currentLabel}. Switch to ${fallbackLabel} to view this study in its original format.`;

  const note = document.createElement('p');
  note.style.cssText = 'margin:0 0 20px;font-size:13px;color:#9ca3af;';
  note.textContent = 'Your saved data source preference is not changed.';

  const actions = document.createElement('div');
  actions.style.cssText = 'display:flex;gap:12px;justify-content:flex-end;flex-wrap:wrap;';

  const dismissBtn = createButton('Not now', false);
  dismissBtn.onclick = () => {
    window.close();
    // Browsers only let a page close a tab that a script opened; otherwise just dismiss.
    setTimeout(() => {
      if (!window.closed) {
        closeOverlay();
      }
    }, 300);
  };

  const switchBtn = createButton(`Switch to ${fallbackLabel}`, true);
  switchBtn.onclick = () => {
    navigateTo406FallbackDataSource(currentSource, fallbackSource);
  };

  actions.appendChild(dismissBtn);
  actions.appendChild(switchBtn);
  box.appendChild(title);
  box.appendChild(message);
  box.appendChild(note);
  box.appendChild(actions);
  overlay.appendChild(box);
  document.body.appendChild(overlay);
  switchBtn.focus();
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
 * @returns {boolean} true when the switch prompt was shown (or already shown for this study)
 */
export function handleDataSource406(options = {}) {
  const cfg = get406FallbackConfig();
  if (!cfg.enabled) {
    return false;
  }

  const currentSource =
    options.currentSource || getDataSourceFromUrl() || getAppConfig().defaultDataSourceName || null;

  // Already on the original data source — there is nothing further to fall back to.
  if (isFallbackDataSourceName(currentSource)) {
    return false;
  }

  const fallbackMap = cfg.fallbackMap || {};
  const fallbackSource = currentSource ? fallbackMap[currentSource] : null;

  if (!fallbackSource || fallbackSource === currentSource) {
    return false;
  }

  const promptKey = getPromptShownKey();
  if (typeof sessionStorage !== 'undefined') {
    if (sessionStorage.getItem(promptKey) === '1') {
      return true;
    }
    sessionStorage.setItem(SESSION_FLAG, '1');
    sessionStorage.setItem(SESSION_TARGET, fallbackSource);
    sessionStorage.setItem(promptKey, '1');
  }

  console.warn(
    `[406 fallback] "${getDataSourceFormatLabel(currentSource)}" (${currentSource}) is not supported for this study` +
      ` (${options.source || 'unknown'}). User may switch to "${getDataSourceFormatLabel(fallbackSource)}" (${fallbackSource}).`
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
  reject(
    new Error(
      `HTTP ${_xhr?.status ?? 406}: ${getDataSourceFormatLabel('localviewer-image-jpeg')} is not supported for this study.`
    )
  );
  return handled;
}

/** Remove legacy keys that caused permanent redirects (one-time cleanup). */
export function clear406FallbackPersistence() {
  if (typeof localStorage !== 'undefined') {
    localStorage.removeItem('ohif406ActiveDataSource');
  }
  if (typeof sessionStorage !== 'undefined') {
    sessionStorage.removeItem(SESSION_FLAG);
    sessionStorage.removeItem(SESSION_TARGET);
    sessionStorage.removeItem(LEGACY_OVERLAY_SHOWN_KEY);
  }
}
