/**
 * Per-user OHIF layout (study panel, measurement panel, hanging protocol).
 * Stored in RIS Preferences.viewerLayout — same auto-save idea as worklist columns.
 *
 * Report iframe and standalone viewer store separate panel widths and hanging
 * protocols so a half-screen report layout does not overwrite the full viewer.
 */

import { isUsFrameDistributionEnabled } from './usFrameDistributionStore';

export const DEFAULT_VIEWER_LAYOUT = {
  version: 1,
  leftPanel: {
    closed: false,
    width: 282,
    studyBrowserViewPreset: 'thumbnails',
  },
  rightPanel: {
    closed: false,
    width: 280,
  },
  hangingProtocolByModality: {},
};

/** Narrower study panel (~one thumbnail column) and closed sidebars for the report iframe. */
export const DEFAULT_IFRAME_LAYOUT = {
  version: 1,
  leftPanel: {
    closed: true,
    width: 160,
    studyBrowserViewPreset: 'thumbnails',
  },
  rightPanel: {
    closed: true,
    width: 240,
  },
  hangingProtocolByModality: {},
};

const SINGLE_INSTANCE_PROTOCOL = {
  kind: 'protocol',
  protocolId: 'allModality1x1',
  stageId: '1x1',
};

const VOLUME_PROTOCOL_IDS = new Set([
  'mpr',
  'axial-primary',
  '3d-four-up',
  '3d-main',
  '3d-only',
  '3d-primary',
]);

/** Reports/overlays, not viewport image series. OT/SC secondary capture is viewable. */
const NON_IMAGE_MODALITIES = new Set(['SR', 'PR', 'SEG', 'KO', 'DOC', 'SM']);

const LEGACY_PROTOCOL_ID_MAP = {
  allModality1x4: 'allModality2x2',
  usModality1x1: 'allModality1x1',
  usModality1x4: 'allModality2x2',
  usModality2x2: 'allModality2x2',
  usModality2x4: 'allModality2x4',
};

const PROTOCOL_TO_GRID = {
  allModality1x1: { numRows: 1, numCols: 1 },
  allModality1x2: { numRows: 1, numCols: 2 },
  allModality2x2: { numRows: 2, numCols: 2 },
  allModality2x4: { numRows: 2, numCols: 4 },
};

let memoryDocument = null;
let hasExplicitLayout = false;
let saveTimer = null;
let loadInFlight = null;
/** Ignore panel/HP auto-saves until the RIS document has been read once. */
let layoutHydrated = false;
/** Block panel auto-saves until GET viewerLayout has been applied to the UI. */
let panelRestoreLocked = true;
let lastServerDocument = null;
const layoutListeners = new Set();
/** When false, do not restore or auto-save layout; use built-in HP / panel defaults. */
let persistViewerLayoutEnabled = false;

function coercePersistFlag(value) {
  return value === true || value === 'true';
}

export function isPersistViewerLayoutEnabled() {
  return persistViewerLayoutEnabled === true;
}

export function setPersistViewerLayoutEnabled(enabled) {
  persistViewerLayoutEnabled = coercePersistFlag(enabled);
}

export function resetViewerLayoutPersistence(options = {}) {
  const persist =
    options.persistViewerLayout !== undefined
      ? coercePersistFlag(options.persistViewerLayout)
      : persistViewerLayoutEnabled;
  const layout = options.viewerLayout;
  setPersistViewerLayoutEnabled(persist);
  if (layout) {
    lastServerDocument = normalizeViewerLayoutDocument(layout);
    setExplicitDocument(layout);
    writeLayoutCookie(memoryDocument);
  } else {
    useBuiltInViewerDefaults();
  }
  layoutHydrated = true;
  try {
    window.mergePreferencesCache?.({
      persistViewerLayout: persist,
      viewerLayout: layout || null,
    });
  } catch {
    // ignore
  }
}

function useBuiltInViewerDefaults() {
  hasExplicitLayout = false;
  panelRestoreLocked = false;
  lastServerDocument = null;
  memoryDocument = emptyDocument();
  if (isViewerInIframe()) {
    seedDefaultClosedPanels();
  }
  notifyLayoutListeners(getActiveContextLayout(memoryDocument));
}

export function isViewerLayoutHydrated() {
  return layoutHydrated;
}

export function isPanelRestoreLocked() {
  return panelRestoreLocked;
}

export function setPanelRestoreLocked(locked) {
  panelRestoreLocked = Boolean(locked);
}

export function isViewerInIframe() {
  try {
    return typeof window !== 'undefined' && window.self !== window.top;
  } catch {
    return true;
  }
}

export function getViewerLayoutContext() {
  return isViewerInIframe() ? 'iframe' : 'standalone';
}

function mergeHangingProtocolMaps(...maps) {
  const out = {};
  maps.forEach(map => {
    if (!map || typeof map !== 'object') {
      return;
    }
    const keys = Object.keys(map);
    if (keys.length === 0) {
      return;
    }
    keys.forEach(key => {
      const modality = String(key).toUpperCase();
      const hpEntry = normalizeHpEntry(map[key]);
      if (modality && hpEntry) {
        out[modality] = hpEntry;
      }
    });
  });
  return out;
}

function cloneLayout(layout) {
  return JSON.parse(JSON.stringify(layout || DEFAULT_VIEWER_LAYOUT));
}

function cloneDocument(doc) {
  return JSON.parse(JSON.stringify(doc || emptyDocument()));
}

function clamp(n, min, max, fallback) {
  const v = Number(n);
  if (!Number.isFinite(v)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.round(v)));
}

function notifyLayoutListeners(layout) {
  layoutListeners.forEach(listener => {
    try {
      listener(cloneLayout(layout));
    } catch {
      // ignore listener errors
    }
  });
}

export function subscribeViewerLayoutLoaded(listener) {
  if (typeof listener !== 'function') {
    return () => {};
  }
  layoutListeners.add(listener);
  if (layoutHydrated && memoryDocument) {
    listener(getActiveContextLayout(memoryDocument));
  }
  return () => layoutListeners.delete(listener);
}

export function hasExplicitViewerLayout() {
  return hasExplicitLayout;
}

function emptyDocument() {
  return {
    version: 2,
    standalone: cloneLayout(DEFAULT_VIEWER_LAYOUT),
    iframe: cloneLayout(DEFAULT_IFRAME_LAYOUT),
  };
}

function isV2Document(raw) {
  return Boolean(raw && typeof raw === 'object' && (raw.standalone || raw.iframe));
}

function getActiveContextLayout(doc = memoryDocument) {
  const context = getViewerLayoutContext();
  const source = doc?.[context];
  if (source) {
    return cloneLayout(normalizeViewerLayout(source));
  }
  return cloneLayout(context === 'iframe' ? DEFAULT_IFRAME_LAYOUT : DEFAULT_VIEWER_LAYOUT);
}

function setExplicitDocument(raw, { notify = true } = {}) {
  hasExplicitLayout = true;
  memoryDocument = normalizeViewerLayoutDocument(raw);
  const active = getActiveContextLayout(memoryDocument);
  if (notify) {
    notifyLayoutListeners(active);
  }
  return active;
}

function normalizeHpEntry(entry) {
  if (!entry || typeof entry !== 'object') {
    return null;
  }
  const rows = entry.numRows;
  const cols = entry.numCols;
  if (entry.kind === 'grid' || ((rows || cols) && entry.kind !== 'protocol')) {
    return {
      kind: 'grid',
      numRows: clamp(rows, 1, 8, 1),
      numCols: clamp(cols, 1, 8, 1),
    };
  }
  const protocolId = entry.protocolId;
  if (typeof protocolId !== 'string' || !protocolId.trim()) {
    return null;
  }
  const out = { kind: 'protocol', protocolId: protocolId.trim() };
  const stageId = entry.stageId;
  if (typeof stageId === 'string' && stageId.trim()) {
    out.stageId = stageId.trim();
  }
  return out;
}

export function normalizeViewerLayout(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const left = src.leftPanel && typeof src.leftPanel === 'object' ? src.leftPanel : {};
  const right = src.rightPanel && typeof src.rightPanel === 'object' ? src.rightPanel : {};
  const hangingProtocolByModality = {};
  const rawHp =
    src.hangingProtocolByModality && typeof src.hangingProtocolByModality === 'object'
      ? src.hangingProtocolByModality
      : {};
  Object.keys(rawHp).forEach(key => {
    const modality = String(key).toUpperCase();
    const hpEntry = normalizeHpEntry(rawHp[key]);
    if (modality && hpEntry) {
      hangingProtocolByModality[modality] = hpEntry;
    }
  });
  const studyBrowserViewPreset =
    left.studyBrowserViewPreset === 'list' || left.studyBrowserViewPreset === 'thumbnails'
      ? left.studyBrowserViewPreset
      : DEFAULT_VIEWER_LAYOUT.leftPanel.studyBrowserViewPreset;

  return {
    version: 1,
    leftPanel: {
      closed: left.closed === true,
      width: clamp(left.width, 145, 800, DEFAULT_VIEWER_LAYOUT.leftPanel.width),
      ...(typeof left.tabIndex === 'number' ? { tabIndex: left.tabIndex } : {}),
      ...(typeof left.tabId === 'string' ? { tabId: left.tabId } : {}),
      studyBrowserViewPreset,
    },
    rightPanel: {
      closed: right.closed === true,
      width: clamp(right.width, 200, 800, DEFAULT_VIEWER_LAYOUT.rightPanel.width),
      ...(typeof right.tabIndex === 'number' ? { tabIndex: right.tabIndex } : {}),
      ...(typeof right.tabId === 'string' ? { tabId: right.tabId } : {}),
    },
    hangingProtocolByModality,
  };
}

function mergeContextSource(base, raw) {
  if (!raw || typeof raw !== 'object') {
    return cloneLayout(base);
  }
  return normalizeViewerLayout({
    ...base,
    ...raw,
    leftPanel: { ...base.leftPanel, ...(raw.leftPanel || {}) },
    rightPanel: { ...base.rightPanel, ...(raw.rightPanel || {}) },
    hangingProtocolByModality: raw.hangingProtocolByModality || base.hangingProtocolByModality,
  });
}

export function normalizeViewerLayoutDocument(raw) {
  if (isV2Document(raw)) {
    return {
      version: 2,
      standalone: mergeContextSource(DEFAULT_VIEWER_LAYOUT, raw.standalone),
      iframe: mergeContextSource(DEFAULT_IFRAME_LAYOUT, raw.iframe),
    };
  }
  if (raw && typeof raw === 'object' && (raw.leftPanel || raw.rightPanel || raw.hangingProtocolByModality)) {
    const migrated = normalizeViewerLayout(raw);
    return {
      version: 2,
      standalone: cloneLayout(migrated),
      iframe: cloneLayout(migrated),
    };
  }
  return emptyDocument();
}

function deepMerge(base, partial) {
  if (!partial || typeof partial !== 'object') {
    return base;
  }
  const out = { ...base };
  Object.keys(partial).forEach(key => {
    const pv = partial[key];
    const bv = out[key];
    if (
      pv &&
      typeof pv === 'object' &&
      !Array.isArray(pv) &&
      bv &&
      typeof bv === 'object' &&
      !Array.isArray(bv)
    ) {
      out[key] = deepMerge(bv, pv);
    } else if (pv !== undefined) {
      out[key] = pv;
    }
  });
  return out;
}

function layoutsEqual(a, b) {
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

function readLayoutFromPreferencesBag(prefs) {
  if (!prefs || typeof prefs !== 'object') {
    return null;
  }
  return prefs.viewerLayout || null;
}

/**
 * Iframe/mobile start with panels collapsed. Keep that in memory so a later
 * hanging-protocol save does not store closed:false while the UI is still closed.
 * Does not mark the layout as user-saved.
 */
export function seedDefaultClosedPanels() {
  if (hasExplicitLayout) {
    return;
  }
  if (!memoryDocument) {
    memoryDocument = emptyDocument();
  }
  const context = getViewerLayoutContext();
  const fallback = context === 'iframe' ? DEFAULT_IFRAME_LAYOUT : DEFAULT_VIEWER_LAYOUT;
  const current = memoryDocument[context] || cloneLayout(fallback);
  memoryDocument = {
    ...memoryDocument,
    version: 2,
    [context]: normalizeViewerLayout({
      ...current,
      leftPanel: { ...current.leftPanel, closed: true },
      rightPanel: { ...current.rightPanel, closed: true },
    }),
  };
}

export function getViewerLayoutSync() {
  if (!persistViewerLayoutEnabled) {
    if (!memoryDocument) {
      memoryDocument = emptyDocument();
    }
    return getActiveContextLayout(memoryDocument);
  }
  if (memoryDocument && hasExplicitLayout) {
    return getActiveContextLayout(memoryDocument);
  }
  try {
    const cookies = window.getPreferencesFromCookies?.();
    const fromPrefs = readLayoutFromPreferencesBag(cookies);
    if (fromPrefs) {
      return setExplicitDocument(fromPrefs, { notify: false });
    }
  } catch {
    // ignore cookie parse errors
  }
  if (!memoryDocument) {
    memoryDocument = emptyDocument();
  }
  return getActiveContextLayout(memoryDocument);
}

function writeLayoutCookie(document) {
  try {
    window.setUserPreferenceCookie?.('viewerLayout', document);
    window.mergePreferencesCache?.({ viewerLayout: document });
  } catch {
    // cookie write is best-effort
  }
}

function notifyParentLayoutSaved(layoutDocument) {
  try {
    if (typeof window === 'undefined' || !window.parent || window.parent === window) {
      return;
    }
    let targetOrigin = '*';
    try {
      if (window.document?.referrer) {
        targetOrigin = new URL(window.document.referrer).origin;
      }
    } catch {
      targetOrigin = '*';
    }
    window.parent.postMessage(
      {
        source: 'DICOMRIS_VIEWER',
        type: 'VIEWER_LAYOUT_SAVED',
        viewerLayout: layoutDocument,
      },
      targetOrigin
    );
  } catch {
    // ignore cross-origin postMessage failures
  }
}

function ensureContextHp(document, context) {
  const layout = document?.[context];
  const hp = layout?.hangingProtocolByModality || {};
  const serverHp = lastServerDocument?.[context]?.hangingProtocolByModality || {};
  if (Object.keys(serverHp).length > 0 && Object.keys(hp).length === 0) {
    return {
      ...document,
      [context]: {
        ...layout,
        hangingProtocolByModality: serverHp,
      },
    };
  }
  return document;
}

async function persistLayoutToApi(layoutDocument) {
  if (!persistViewerLayoutEnabled) {
    return;
  }
  const context = getViewerLayoutContext();
  const nextDocument = ensureContextHp(cloneDocument(layoutDocument), context);
  lastServerDocument = cloneDocument(nextDocument);
  writeLayoutCookie(nextDocument);
  notifyParentLayoutSaved({
    version: 2,
    [context]: nextDocument[context],
  });
  const saveFn = window.savePreferences;
  if (typeof saveFn !== 'function') {
    console.warn('[viewerLayout] window.savePreferences is not available');
    return;
  }
  try {
    const result = await saveFn({
      viewerLayout: {
        version: 2,
        [context]: nextDocument[context],
      },
    });
    writeLayoutCookie(nextDocument);
    if (!result) {
      console.warn('[viewerLayout] RIS savePreferences returned no result (check token / API URL)');
    }
  } catch (error) {
    console.warn('[viewerLayout] Failed to save layout preferences', error);
  }
}

export function mergeAndSaveViewerLayout(partial, options = {}) {
  if (!persistViewerLayoutEnabled) {
    return getViewerLayoutSync();
  }
  const debounceMs = options.debounceMs ?? 400;
  const force = options.force === true;
  if (!layoutHydrated && !force) {
    return getViewerLayoutSync();
  }
  if (panelRestoreLocked && !force) {
    return getViewerLayoutSync();
  }
  let safePartial = partial || {};
  const isUserAction = options.userAction === true;
  const context = getViewerLayoutContext();
  const serverContext = lastServerDocument?.[context];
  if (!isUserAction && !force && serverContext) {
    safePartial = { ...safePartial };
    ['leftPanel', 'rightPanel'].forEach(side => {
      const incoming = safePartial[side];
      if (!incoming || typeof incoming !== 'object' || !('closed' in incoming)) {
        return;
      }
      if (serverContext[side]?.closed === true && incoming.closed === false) {
        const rest = { ...incoming };
        delete rest.closed;
        safePartial[side] = rest;
      }
    });
  }
  const current = getViewerLayoutSync();
  const merged = deepMerge(current, safePartial);
  merged.hangingProtocolByModality = mergeHangingProtocolMaps(
    serverContext?.hangingProtocolByModality,
    current.hangingProtocolByModality,
    safePartial?.hangingProtocolByModality
  );
  const next = normalizeViewerLayout(merged);
  next.hangingProtocolByModality = mergeHangingProtocolMaps(
    serverContext?.hangingProtocolByModality,
    next.hangingProtocolByModality
  );
  if (hasExplicitLayout && layoutsEqual(current, next)) {
    return next;
  }
  hasExplicitLayout = true;
  if (!memoryDocument) {
    memoryDocument = emptyDocument();
  }
  memoryDocument = {
    ...memoryDocument,
    version: 2,
    [context]: next,
  };
  writeLayoutCookie(memoryDocument);
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  if (debounceMs <= 0) {
    persistLayoutToApi(memoryDocument);
    return next;
  }
  saveTimer = setTimeout(() => {
    saveTimer = null;
    persistLayoutToApi(memoryDocument);
  }, debounceMs);
  return next;
}

export function saveViewerLayoutNow(partial) {
  return mergeAndSaveViewerLayout(partial, { debounceMs: 0, force: true });
}

export function saveHangingProtocolChoice(entry, servicesManager) {
  if (!entry || !persistViewerLayoutEnabled) {
    return null;
  }
  const modality = getPrimaryModality(servicesManager);
  return mergeAndSaveViewerLayout(
    {
      hangingProtocolByModality: {
        [modality]: entry,
        DEFAULT: entry,
      },
    },
    { debounceMs: 0, force: true }
  );
}

export async function loadViewerLayoutFromApi() {
  if (loadInFlight) {
    return loadInFlight;
  }
  loadInFlight = (async () => {
    try {
      if (typeof window.fetchViewerLayoutFromApi === 'function') {
        const fromApi = await window.fetchViewerLayoutFromApi();
        let persist = persistViewerLayoutEnabled;
        let layout = null;
        if (fromApi && typeof fromApi === 'object') {
          if ('persistViewerLayout' in fromApi) {
            persist = coercePersistFlag(fromApi.persistViewerLayout);
            layout = fromApi.viewerLayout || null;
          } else {
            layout = fromApi;
          }
        }
        setPersistViewerLayoutEnabled(persist);
        if (!persist) {
          useBuiltInViewerDefaults();
          layoutHydrated = true;
          return getViewerLayoutSync();
        }
        if (layout) {
          lastServerDocument = normalizeViewerLayoutDocument(layout);
          const next = setExplicitDocument(layout);
          writeLayoutCookie(memoryDocument);
          layoutHydrated = true;
          return next;
        }
      }
    } catch (error) {
      console.warn('[viewerLayout] Failed to load layout from API', error);
    }
    layoutHydrated = true;
    const current = getViewerLayoutSync();
    notifyLayoutListeners(current);
    return current;
  })().finally(() => {
    loadInFlight = null;
  });
  return loadInFlight;
}

export function hasUrlHangingProtocolOverride() {
  try {
    const params = new URLSearchParams(window.location.search);
    const hp = params.get('hangingProtocolId');
    return Boolean(hp && hp !== 'default');
  } catch {
    return false;
  }
}

export function isJpegDataSourceActive() {
  try {
    const path = window.location?.pathname ?? '';
    const params = new URLSearchParams(window.location.search);
    const ds = (params.get('datasources') || '').toLowerCase();
    return path.includes('/localviewer-image-jpeg') || ds === 'localviewer-image-jpeg';
  } catch {
    return false;
  }
}

export function isVolumeProtocolId(protocolId) {
  return typeof protocolId === 'string' && VOLUME_PROTOCOL_IDS.has(protocolId);
}

export function getHangingProtocolService(servicesManager) {
  return servicesManager?.services?.hangingProtocolService || null;
}

export function getDisplaySetService(servicesManager) {
  return servicesManager?.services?.displaySetService || null;
}

export function getActiveStudyUID(servicesManager) {
  const hangingProtocolService = getHangingProtocolService(servicesManager);
  const fromState = hangingProtocolService?.getState?.()?.activeStudyUID;
  if (fromState) {
    return fromState;
  }
  const studies = hangingProtocolService?.studies;
  if (Array.isArray(studies) && studies[0]?.StudyInstanceUID) {
    return studies[0].StudyInstanceUID;
  }
  const displaySets = getDisplaySetService(servicesManager)?.getActiveDisplaySets?.() || [];
  return displaySets[0]?.StudyInstanceUID || null;
}

/** True once OHIF has a study/display set that setHangingProtocol can use. */
export function isStudyReadyForHangingProtocol(servicesManager) {
  const displaySets = getDisplaySetService(servicesManager)?.getActiveDisplaySets?.() || [];
  if (displaySets.length > 0) {
    return true;
  }
  return Boolean(getActiveStudyUID(servicesManager));
}

export function getPrimaryModality(servicesManager) {
  const displaySetService = getDisplaySetService(servicesManager);
  const hangingProtocolService = getHangingProtocolService(servicesManager);
  const active = displaySetService?.getActiveDisplaySets?.() || [];
  const imageDs = active.find(ds => ds?.Modality && !NON_IMAGE_MODALITIES.has(String(ds.Modality).toUpperCase()));
  if (imageDs?.Modality) {
    return String(imageDs.Modality).toUpperCase();
  }
  const studies = hangingProtocolService?.studies;
  const mods = studies?.[0]?.ModalitiesInStudy;
  if (typeof mods === 'string' && mods.trim()) {
    const first = mods
      .split(/[\s\\/]+/)
      .map(m => m.toUpperCase())
      .find(m => m && !NON_IMAGE_MODALITIES.has(m));
    if (first) {
      return first;
    }
  }
  return 'DEFAULT';
}

export function getImageDisplaySetCount(servicesManager) {
  const displaySets = getDisplaySetService(servicesManager)?.getActiveDisplaySets?.() || [];
  return displaySets.filter(isViewableImageDisplaySet).length;
}

function isViewableImageDisplaySet(ds) {
  if (!ds || ds.unsupported) {
    return false;
  }
  const modality = String(ds.Modality || '').toUpperCase();
  if (NON_IMAGE_MODALITIES.has(modality)) {
    return false;
  }
  if (typeof ds.SOPClassHandlerId === 'string' && ds.SOPClassHandlerId.includes('dicom-sr')) {
    return false;
  }
  const frames = ds.numImageFrames ?? ds.instances?.length ?? ds.imageIds?.length ?? 0;
  return frames > 0;
}

export function getSavedHangingProtocol(layout, modality) {
  const map = layout?.hangingProtocolByModality || {};
  const key = String(modality || 'DEFAULT').toUpperCase();
  return map[key] || map.DEFAULT || null;
}

export function mapLegacyProtocolId(protocolId) {
  if (!protocolId) {
    return protocolId;
  }
  return LEGACY_PROTOCOL_ID_MAP[protocolId] || protocolId;
}

export function savedLayoutNeedsMultipleViewports(saved) {
  if (!saved) {
    return false;
  }
  if (saved.kind === 'grid') {
    return (saved.numRows || 1) * (saved.numCols || 1) > 1;
  }
  const grid = PROTOCOL_TO_GRID[mapLegacyProtocolId(saved.protocolId)];
  if (!grid) {
    return false;
  }
  return grid.numRows * grid.numCols > 1;
}

/**
 * A single image instance always hangs 1×1 (plus optional SR). Saved 1×2/2×2
 * is used only when the study has multiple image instances. Frame Dist can
 * still split one US cine across a grid.
 */
export function resolveHangingProtocolToApply(layout, modality, servicesManager) {
  const displaySets = getDisplaySetService(servicesManager)?.getActiveDisplaySets?.() || [];
  if (displaySets.length === 0) {
    return null;
  }

  let frameDistOn = false;
  try {
    frameDistOn = isUsFrameDistributionEnabled();
  } catch {
    frameDistOn = false;
  }

  const imageCount = getImageDisplaySetCount(servicesManager);
  if (imageCount <= 1 && !frameDistOn) {
    return SINGLE_INSTANCE_PROTOCOL;
  }

  if (!isPersistViewerLayoutEnabled()) {
    return null;
  }

  const saved = getSavedHangingProtocol(layout, modality);
  if (!saved) {
    return null;
  }
  if (savedLayoutNeedsMultipleViewports(saved) && imageCount <= 1) {
    return SINGLE_INSTANCE_PROTOCOL;
  }
  return saved;
}

export function savedHangingProtocolMatchesCurrent(saved, servicesManager) {
  if (!saved) {
    return false;
  }
  const hangingProtocolService = getHangingProtocolService(servicesManager);
  const viewportGridService = servicesManager?.services?.viewportGridService;
  const hpState = hangingProtocolService?.getState?.();
  const grid = viewportGridService?.getState?.()?.layout;
  const currentProtocolId = mapLegacyProtocolId(hpState?.protocolId);

  if (saved.kind === 'protocol') {
    const savedId = mapLegacyProtocolId(saved.protocolId);
    if (currentProtocolId && currentProtocolId === savedId) {
      return true;
    }
    const expectedGrid = PROTOCOL_TO_GRID[savedId];
    if (
      expectedGrid &&
      grid?.numRows === expectedGrid.numRows &&
      grid?.numCols === expectedGrid.numCols
    ) {
      return true;
    }
    return false;
  }

  if (saved.kind === 'grid') {
    return grid?.numRows === saved.numRows && grid?.numCols === saved.numCols;
  }
  return false;
}

export function resolveTabIndex(tabs, saved) {
  if (!saved) {
    return undefined;
  }
  if (saved.tabId && Array.isArray(tabs)) {
    const idx = tabs.findIndex(tab => tab.id === saved.tabId);
    if (idx >= 0) {
      return idx;
    }
  }
  if (typeof saved.tabIndex === 'number' && saved.tabIndex >= 0) {
    return saved.tabIndex;
  }
  return undefined;
}

if (typeof window !== 'undefined') {
  window.resetViewerLayoutPersistence = resetViewerLayoutPersistence;
  window.addEventListener('RIS_AUTH_SESSION', event => {
    const prefs = event?.detail?.preferences;
    if (prefs && prefs.persistViewerLayout !== undefined) {
      setPersistViewerLayoutEnabled(prefs.persistViewerLayout);
    }
    if (!persistViewerLayoutEnabled) {
      useBuiltInViewerDefaults();
      loadViewerLayoutFromApi();
      return;
    }
    const layout = prefs?.viewerLayout;
    // GET preferences is the source of truth. Do not let a stale AUTH_SESSION
    // layout overwrite panels after the API document has been applied.
    if (layout && !layoutHydrated) {
      lastServerDocument = normalizeViewerLayoutDocument(layout);
      setExplicitDocument(layout);
      writeLayoutCookie(memoryDocument);
    }
    if (!layoutHydrated) {
      loadViewerLayoutFromApi();
    }
  });
}
