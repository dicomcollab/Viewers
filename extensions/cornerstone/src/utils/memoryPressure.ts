import { cache, getRenderingEngines } from '@cornerstonejs/core';

/**
 * Keeps the decoded-image cache inside what the browser can actually allocate.
 *
 * Several viewer tabs (one per study) usually share one renderer process, and
 * each has its own Cornerstone cache (3 GB default). Together they exceed the
 * process limit and decoding fails with "Array buffer allocation failed",
 * leaving tiles black. So:
 * - the visible tab gets a budget sized to the device,
 * - a tab hidden for a while shrinks its cache to the frames on screen,
 * - an allocation failure trims the cache and lowers the budget,
 * - viewer tabs tell each other (BroadcastChannel) when one is shown or runs out
 *   of memory, so hidden ones free their frames right away.
 * Evicted frames reload from the persistent (IndexedDB) cache or the network.
 */

const MB = 1024 * 1024;
const MIN_VISIBLE_BUDGET = 512 * MB;
const MAX_VISIBLE_BUDGET = 1536 * MB;
const DEVICE_MEMORY_FRACTION = 0.25;
/** The on-screen clips may grow the budget up to this share of device memory. */
const DEVICE_MEMORY_GROW_FRACTION = 0.5;
const MAX_GROW_CEILING = 2048 * MB;
const GROW_HEADROOM = 64 * MB;
const HIDDEN_BUDGET = 256 * MB;
/** Hidden tab after another viewer tab ran out of memory: keep little more than the tiles. */
const HIDDEN_BUDGET_UNDER_PRESSURE = 64 * MB;
/** Quick tab switches should not throw away decoded frames. */
const HIDDEN_TRIM_DELAY_MS = 10_000;
const MIN_BUDGET_AFTER_OOM = 384 * MB;
const OOM_BUDGET_FRACTION = 0.6;
const OOM_RELIEF_COOLDOWN_MS = 3000;
/** Without further failures the grow ceiling climbs back by this step. */
const CEILING_RECOVERY_INTERVAL_MS = 60_000;
const CEILING_RECOVERY_STEP = 256 * MB;
const RESTORE_DEBOUNCE_MS = 500;
const MEMORY_PRESSURE_WINDOW_MS = 30_000;
const CHANNEL_NAME = 'ohif-viewer-memory';

type ChannelMessage = { type: 'visible' | 'pressure'; tabId: string };

type MemoryStateListener = (state: { trimmedForHiddenTab: boolean }) => void;

type CachedImageEntry = {
  imageId: string;
  loaded?: boolean;
  sizeInBytes?: number;
  sharedCacheKey?: string;
  timeStamp?: number;
};

let installed = false;
let visibleBudget = MIN_VISIBLE_BUDGET;
/** Highest budget the on-screen clips may grow to; lowered after an allocation failure. */
let growCeiling = MIN_VISIBLE_BUDGET;
let deviceGrowCeiling = MIN_VISIBLE_BUDGET;
let protectedImageIdsProvider: (() => Map<string, number>) | null = null;
let trimmedForHiddenTab = false;
let hiddenTrimTimer: ReturnType<typeof setTimeout> | null = null;
let restoreTimer: ReturnType<typeof setTimeout> | null = null;
let ceilingRecoveryTimer: ReturnType<typeof setInterval> | null = null;
let lastOomReliefAt = 0;
let channel: BroadcastChannel | null = null;
const tabId = Math.random().toString(36).slice(2);
const listeners = new Set<MemoryStateListener>();
const restoreCallbacks = new Set<() => void>();

const OOM_MESSAGE =
  /array buffer allocation failed|allocation failed|invalid typed array length|invalid array buffer length|out of memory/i;

export function isOutOfMemoryError(error: unknown): boolean {
  if (!error) {
    return false;
  }
  const message =
    typeof error === 'string'
      ? error
      : String((error as { message?: unknown })?.message ?? (error as object)?.toString?.() ?? '');
  return OOM_MESSAGE.test(message);
}

function getDeviceMemoryBytes(): number {
  // Chrome reports 0.25..8 (GB, rounded); other browsers fall back to 4 GB.
  const deviceGb = Number((navigator as { deviceMemory?: number }).deviceMemory) || 4;
  return deviceGb * 1024 * MB;
}

function computeVisibleBudget(configuredMaxCacheSize?: number): number {
  if (Number(configuredMaxCacheSize) > 0) {
    return Number(configuredMaxCacheSize);
  }
  const budget = Math.floor(getDeviceMemoryBytes() * DEVICE_MEMORY_FRACTION);
  return Math.max(MIN_VISIBLE_BUDGET, Math.min(MAX_VISIBLE_BUDGET, budget));
}

function computeGrowCeiling(configuredMaxCacheSize?: number): number {
  if (Number(configuredMaxCacheSize) > 0) {
    return Number(configuredMaxCacheSize);
  }
  const ceiling = Math.floor(getDeviceMemoryBytes() * DEVICE_MEMORY_GROW_FRACTION);
  return Math.max(visibleBudget, Math.min(MAX_GROW_CEILING, ceiling));
}

/**
 * Frames of the clips on screen are evicted last. The provider maps each frame
 * to how soon it is needed (0 = next); among them the one needed last goes first.
 */
export function setProtectedImageIdsProvider(provider: (() => Map<string, number>) | null): void {
  protectedImageIdsProvider = provider;
}

/** Frames on screen are evicted last so tiles keep their current image. */
function getOnScreenImageIds(): string[] {
  const imageIds: string[] = [];
  try {
    getRenderingEngines().forEach(engine => {
      if (engine.hasBeenDestroyed) {
        return;
      }
      engine.getViewports().forEach(viewport => {
        const imageId = (viewport as { getCurrentImageId?: () => string }).getCurrentImageId?.();
        if (imageId) {
          imageIds.push(imageId);
        }
      });
    });
  } catch {
    // Rendering engine mid-teardown.
  }
  return imageIds;
}

/** imageId -> how soon it is needed; frames on screen now rank first (-1). */
function getProtectedImageIds(extra?: string[]): Map<string, number> {
  let ranks = new Map<string, number>();
  // Also while hidden: the frames that play next stay, so coming back is smooth.
  if (protectedImageIdsProvider) {
    try {
      ranks = new Map(protectedImageIdsProvider());
    } catch {
      // Provider is best effort.
    }
  }
  getOnScreenImageIds().forEach(id => ranks.set(id, -1));
  extra?.forEach(id => ranks.set(id, -1));
  return ranks;
}

function evictEntries(entries: CachedImageEntry[], numBytes: number): number {
  let available = cache.getBytesAvailable();
  for (const entry of entries) {
    if (available >= numBytes) {
      break;
    }
    try {
      // Fires IMAGE_CACHE_IMAGE_REMOVED, so clip progress follows.
      cache.removeImageLoadObject(entry.imageId);
    } catch {
      // Already removed.
    }
    available = cache.getBytesAvailable();
  }
  return available;
}

/**
 * Replacement for Cornerstone's LRU decache, which also purges frames that are
 * still downloading (they free 0 bytes and are older than the newest decode).
 * Each finished download then lands nowhere ("purged before it completed
 * loading"), so a full cache made clip frames fail over and over. Here:
 * - only decoded entries are evicted,
 * - frames off screen go first, frames of on-screen clips last,
 * - before evicting on-screen clip frames, the budget grows toward the ceiling,
 * - on-screen clip frames go in order of when the loop needs them again (the
 *   frame just played first). Plain LRU would drop the frames about to play.
 */
function evictUntilBytesAvailable(
  numBytes: number,
  keepImageIds?: string[],
  allowGrow = true
): number {
  let available = cache.getBytesAvailable();
  if (available >= numBytes) {
    return available;
  }

  const imageCache = (cache as unknown as { _imageCache?: Map<string, CachedImageEntry> })
    ._imageCache;
  if (!imageCache) {
    return available;
  }

  const decoded = Array.from(imageCache.values())
    .filter(entry => entry.loaded && !entry.sharedCacheKey && (entry.sizeInBytes ?? 0) > 0)
    .sort((a, b) => (a.timeStamp ?? 0) - (b.timeStamp ?? 0));
  const protectedIds = getProtectedImageIds(keepImageIds);

  available = evictEntries(
    decoded.filter(entry => !protectedIds.has(entry.imageId)),
    numBytes
  );
  if (available >= numBytes) {
    return available;
  }

  if (allowGrow && !trimmedForHiddenTab && document.visibilityState !== 'hidden') {
    const needed = cache.getCacheSize() + numBytes + GROW_HEADROOM;
    const grown = Math.min(growCeiling, needed);
    if (grown > cache.getMaxCacheSize()) {
      cache.setMaxCacheSize(grown);
      visibleBudget = grown;
      available = cache.getBytesAvailable();
      if (available >= numBytes) {
        return available;
      }
    }
  }

  return evictEntries(
    decoded
      .filter(entry => protectedIds.has(entry.imageId))
      .sort((a, b) => (protectedIds.get(b.imageId) ?? 0) - (protectedIds.get(a.imageId) ?? 0)),
    numBytes
  );
}

function patchCacheEviction(): void {
  const target = cache as unknown as {
    decacheIfNecessaryUntilBytesAvailable: (numBytes: number, keep?: string[]) => number;
    __ohifEvictionPatched?: boolean;
  };
  if (target.__ohifEvictionPatched) {
    return;
  }
  target.decacheIfNecessaryUntilBytesAvailable = (numBytes, keep) =>
    evictUntilBytesAvailable(numBytes, keep);
  target.__ohifEvictionPatched = true;
}

/**
 * Other extensions set their own cache size at registration (dynamic-volume: 5 GB).
 * Past the grow ceiling a 2x2 cine page piles up gigabytes of decoded frames, the
 * renderer runs out of memory and tiles go black, so every caller is capped.
 */
function patchMaxCacheSize(): void {
  const target = cache as unknown as {
    setMaxCacheSize: (bytes: number) => void;
    __ohifMaxSizePatched?: boolean;
  };
  if (target.__ohifMaxSizePatched) {
    return;
  }
  const setMaxCacheSize = target.setMaxCacheSize.bind(cache);
  target.setMaxCacheSize = bytes => {
    const cap = Math.max(growCeiling, visibleBudget);
    setMaxCacheSize(Number(bytes) > cap ? cap : bytes);
  };
  target.__ohifMaxSizePatched = true;
}

function trimCacheTo(maxBytes: number): void {
  try {
    cache.setMaxCacheSize(maxBytes);
    if (cache.getCacheSize() > maxBytes) {
      evictUntilBytesAvailable(0, undefined, false);
    }
  } catch (error) {
    console.warn('[memoryPressure] Cache trim failed:', error);
  }
}

function runRestoreCallbacks(): void {
  restoreCallbacks.forEach(callback => {
    try {
      callback();
    } catch {
      // Restore is best effort per viewport.
    }
  });
}

function notifyListeners(): void {
  listeners.forEach(listener => {
    try {
      listener({ trimmedForHiddenTab });
    } catch {
      // A listener must not break the others.
    }
  });
}

/** Re-bind tiles that lost their image (debounced; only while the tab is shown). */
export function scheduleMemoryRestore(delayMs = RESTORE_DEBOUNCE_MS): void {
  if (restoreTimer || typeof document === 'undefined') {
    return;
  }
  restoreTimer = setTimeout(() => {
    restoreTimer = null;
    if (document.visibilityState === 'visible') {
      runRestoreCallbacks();
    }
  }, delayMs);
}

function postToOtherTabs(type: ChannelMessage['type']): void {
  try {
    channel?.postMessage({ type, tabId } as ChannelMessage);
  } catch {
    // Channel closed.
  }
}

function trimHiddenTab(budget: number, reason: string): void {
  if (hiddenTrimTimer) {
    clearTimeout(hiddenTrimTimer);
    hiddenTrimTimer = null;
  }
  if (document.visibilityState !== 'hidden') {
    return;
  }
  const before = cache.getCacheSize();
  const wasTrimmed = trimmedForHiddenTab;
  trimmedForHiddenTab = true;
  trimCacheTo(budget);
  if (!wasTrimmed) {
    notifyListeners();
  }
  console.info(
    `[memoryPressure] Tab hidden (${reason}): image cache ${Math.round(before / MB)} MB -> ${Math.round(
      cache.getCacheSize() / MB
    )} MB`
  );
}

function onChannelMessage(event: MessageEvent<ChannelMessage>): void {
  const message = event?.data;
  if (!message || message.tabId === tabId || document.visibilityState !== 'hidden') {
    return;
  }
  if (message.type === 'pressure') {
    trimHiddenTab(HIDDEN_BUDGET_UNDER_PRESSURE, 'another viewer tab ran out of memory');
  } else if (message.type === 'visible') {
    trimHiddenTab(HIDDEN_BUDGET, 'another viewer tab is in front');
  }
}

function onVisibilityChange(): void {
  if (document.visibilityState === 'hidden') {
    if (!hiddenTrimTimer && !trimmedForHiddenTab) {
      hiddenTrimTimer = setTimeout(() => {
        hiddenTrimTimer = null;
        trimHiddenTab(HIDDEN_BUDGET, 'idle');
      }, HIDDEN_TRIM_DELAY_MS);
    }
    return;
  }

  if (hiddenTrimTimer) {
    clearTimeout(hiddenTrimTimer);
    hiddenTrimTimer = null;
  }

  postToOtherTabs('visible');
  cache.setMaxCacheSize(visibleBudget);

  if (trimmedForHiddenTab) {
    trimmedForHiddenTab = false;
    notifyListeners();
  }

  runRestoreCallbacks();
}

/** The failure may have come from another tab that has since freed memory. */
function recoverGrowCeiling(): void {
  if (growCeiling >= deviceGrowCeiling) {
    return;
  }
  if (Date.now() - lastOomReliefAt < CEILING_RECOVERY_INTERVAL_MS) {
    return;
  }
  growCeiling = Math.min(deviceGrowCeiling, growCeiling + CEILING_RECOVERY_STEP);
}

/**
 * Free decoded images after an allocation failure and keep the budget below the
 * level that just failed. Returns true when memory was released.
 */
export function relieveMemoryPressure(reason: string): boolean {
  const now = Date.now();
  if (now - lastOomReliefAt < OOM_RELIEF_COOLDOWN_MS) {
    return false;
  }
  lastOomReliefAt = now;

  const before = cache.getCacheSize();
  visibleBudget = Math.max(
    MIN_BUDGET_AFTER_OOM,
    Math.min(visibleBudget, Math.floor(before * OOM_BUDGET_FRACTION))
  );
  // The process just failed near this size; never grow back past it.
  growCeiling = visibleBudget;
  trimCacheTo(document.visibilityState === 'hidden' ? HIDDEN_BUDGET : visibleBudget);

  console.warn(
    `[memoryPressure] Out of memory (${reason}): image cache ${Math.round(before / MB)} MB -> ${Math.round(
      cache.getCacheSize() / MB
    )} MB, budget now ${Math.round(visibleBudget / MB)} MB`
  );

  // Other viewer tabs in this browser process hold memory too.
  postToOtherTabs('pressure');
  // Tiles whose frame failed to decode stay black unless they are re-bound.
  scheduleMemoryRestore();
  return true;
}

export function isMemoryTrimmedForHiddenTab(): boolean {
  return trimmedForHiddenTab;
}

/** Shortly after an allocation failure: skip optional copies (e.g. writing responses to IndexedDB). */
export function isUnderMemoryPressure(): boolean {
  return lastOomReliefAt > 0 && Date.now() - lastOomReliefAt < MEMORY_PRESSURE_WINDOW_MS;
}

export function subscribeMemoryState(listener: MemoryStateListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Called when the tab becomes visible again, e.g. to repaint tiles that lost their image. */
export function onMemoryRestore(callback: () => void): () => void {
  restoreCallbacks.add(callback);
  return () => restoreCallbacks.delete(callback);
}

export function installMemoryPressureManager({
  configuredMaxCacheSize,
}: {
  configuredMaxCacheSize?: number;
} = {}): void {
  visibleBudget = computeVisibleBudget(configuredMaxCacheSize);
  growCeiling = computeGrowCeiling(configuredMaxCacheSize);
  deviceGrowCeiling = growCeiling;
  patchMaxCacheSize();
  cache.setMaxCacheSize(visibleBudget);
  if (cache.getCacheSize() > visibleBudget) {
    trimCacheTo(visibleBudget);
  }

  if (installed || typeof document === 'undefined') {
    return;
  }
  installed = true;
  patchCacheEviction();

  document.addEventListener('visibilitychange', onVisibilityChange);
  ceilingRecoveryTimer ??= setInterval(recoverGrowCeiling, CEILING_RECOVERY_INTERVAL_MS);

  try {
    if (typeof BroadcastChannel !== 'undefined') {
      channel = new BroadcastChannel(CHANNEL_NAME);
      channel.onmessage = onChannelMessage;
      if (document.visibilityState !== 'hidden') {
        postToOtherTabs('visible');
      }
    }
  } catch {
    channel = null;
  }

  const onUncaught = (error: unknown) => {
    if (isOutOfMemoryError(error)) {
      relieveMemoryPressure('uncaught');
    }
  };
  window.addEventListener('unhandledrejection', event => onUncaught(event.reason));
  window.addEventListener('error', event => onUncaught(event.error ?? event.message));
}
