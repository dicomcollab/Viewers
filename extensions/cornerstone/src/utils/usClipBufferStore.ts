import {
  cache,
  eventTarget,
  imageLoader,
  imageLoadPoolManager,
  Enums,
  EVENTS,
} from '@cornerstonejs/core';
import { isStackFrameReady } from './cineFrameLoadUtils';
import { getCineDisplaySetFromViewport, isUsMultiframeDisplaySet } from './cineSyncUtils';
import { getAliveViewport } from './safeViewportFrameUtils';
import { getCinePlayhead, subscribeCinePlayhead } from './cinePlayheadStore';
import {
  isMemoryTrimmedForHiddenTab,
  isOutOfMemoryError,
  onMemoryRestore,
  relieveMemoryPressure,
  setProtectedImageIdsProvider,
  subscribeMemoryState,
} from './memoryPressure';

/**
 * In-order download for ultrasound clips: every frame of a displayed US
 * multiframe instance is downloaded and decoded in order (frame 1 first).
 * Cine loops over the frames decoded so far and picks up new ones as they
 * arrive. Progress is reported to the study panel (studyPrefetcherService).
 *
 * One clip per instance, shared by every tile that shows it. Clips with no
 * visible tile stop issuing requests (page change) but keep their progress.
 */

export type ClipBufferStatus = 'loading' | 'ready' | 'error';

export type ClipBufferProgress = {
  status: ClipBufferStatus;
  loaded: number;
  total: number;
  failed: number;
};

type ClipState = {
  key: string;
  imageIds: string[];
  /** Decoded and in the image cache right now. */
  ready: boolean[];
  loaded: number;
  /**
   * Downloaded at least once. A full cache evicts frames again, but they come
   * back from the browser / IndexedDB cache in milliseconds, so progress counts them.
   */
  downloaded: boolean[];
  downloadedCount: number;
  inFlight: Set<number>;
  attempts: Map<number, number>;
  /** Refetches that do not count as failures: evicted before use, out of memory, stalled. */
  evictions: Map<number, number>;
  retryAt: Map<number, number>;
  failed: Set<number>;
  viewers: Set<string>;
  status: ClipBufferStatus;
  autoRetryRound: number;
  autoRetryTimer: ReturnType<typeof setTimeout> | null;
};

/** Cap when few clips are active; with 4 visible clips each gets 12 / 4 = 3. */
const MAX_IN_FLIGHT_PER_CLIP = 6;
const MAX_IN_FLIGHT_TOTAL = 12;
const MAX_ATTEMPTS = 3;
const RETRY_BACKOFF_MS = [500, 1500, 4000];
/**
 * Frames that failed every attempt are retried again on their own after these
 * delays; the last delay repeats for as long as the clip is on screen.
 */
const AUTO_RETRY_DELAYS_MS = [3000, 10000, 30000];
const MAX_EVICTION_REFETCHES = 8;
const EVICTION_REFETCH_DELAY_MS = 300;
/** Out of memory: give the cache trim and garbage collection time before refetching. */
const MEMORY_REFETCH_DELAY_MS = 1500;
/**
 * A request that has not settled by then is treated as hung and its slot is
 * reused; otherwise a few hung requests would hold every slot and the clip
 * would stop downloading for good.
 */
const FRAME_LOAD_STALL_MS = 45_000;
/**
 * Evicted frames are fetched again only this far ahead of the playhead, so a
 * clip set larger than the cache plays smoothly instead of re-downloading the
 * whole loop over and over.
 */
const PLAYHEAD_LOOKAHEAD_FRAMES = 30;
const PLAYHEAD_PUMP_INTERVAL_MS = 100;

class FrameEvictedError extends Error {
  constructor() {
    super('Frame evicted from the image cache before use');
  }
}

/**
 * An allocation failure (or the empty / truncated response the browser hands
 * over when it could not allocate the body) clears up once memory is freed.
 */
function isMemoryRelatedLoadError(error: unknown): boolean {
  if (isOutOfMemoryError(error)) {
    return true;
  }
  const message = String((error as { message?: unknown })?.message ?? error ?? '');
  return /no multipart mime header/i.test(message);
}

/** Drop a still-pending cache entry so the next request starts a fresh download. */
function dropPendingCacheEntry(imageId: string): void {
  try {
    const entry = (
      cache as unknown as { _imageCache?: Map<string, { loaded?: boolean }> }
    )._imageCache?.get(imageId);
    if (entry && !entry.loaded) {
      cache.removeImageLoadObject(imageId);
    }
  } catch {
    // Already gone.
  }
}
/**
 * Study-browser thumbnails go first (for US they are frame 1 of each clip, so the
 * tiles paint immediately). Bounded so a hung thumbnail cannot hold clips back.
 */
const THUMBNAILS_FIRST_MAX_WAIT_MS = 4000;
const THUMBNAILS_RECHECK_MS = 150;
/** Coalesce per-frame progress into a few study panel updates per second. */
const PROGRESS_PUBLISH_INTERVAL_MS = 150;

const clips = new Map<string, ClipState>();
const clipKeyByViewport = new Map<string, string>();
const displaySetByViewport = new Map<string, string>();
/**
 * Clip released by a page change while the tile still holds the old stack
 * (setStack waits for the new frame 1). The old cine ticker must not re-attach it.
 * Cleared as soon as the grid shows `displaySetUid` in that tile again.
 */
const blockedKeyByViewport = new Map<string, { key: string; displaySetUid: string | null }>();
const clipKeysByImageId = new Map<string, Set<string>>();
/** Frames downloaded at least once; if evicted they reload from the local cache. */
const downloadedImageIds = new Set<string>();

let totalInFlight = 0;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let thumbnailsRecheckTimer: ReturnType<typeof setTimeout> | null = null;
let thumbnailsWaitStartedAt: number | null = null;
let cacheListenerBound = false;
let boundServicesManager: AppTypes.ServicesManager | null = null;
let backgroundPrefetchPaused = false;
let progressPublishTimer: ReturnType<typeof setTimeout> | null = null;
/** Display sets whose clip progress the study panel currently shows. */
const publishedDisplaySetUids = new Set<string>();

function getClipKey(imageIds: string[]): string {
  return `${imageIds.length}|${imageIds[0]}|${imageIds[imageIds.length - 1]}`;
}

function getStudyPrefetcherService() {
  return boundServicesManager?.services?.studyPrefetcherService;
}

/**
 * Send each on-screen clip's progress to the study panel, and clear the
 * progress of display sets no tile shows any more.
 */
function publishProgress(): void {
  progressPublishTimer = null;

  const studyPrefetcherService = getStudyPrefetcherService();

  if (!studyPrefetcherService?.reportViewportDownloadProgress) {
    return;
  }

  const current = new Map<string, ClipBufferProgress>();

  displaySetByViewport.forEach((displaySetUid, viewportId) => {
    const progress = getViewportClipProgress(viewportId);

    if (displaySetUid && progress && progress.total > 1) {
      current.set(displaySetUid, progress);
    }
  });

  publishedDisplaySetUids.forEach(displaySetUid => {
    if (!current.has(displaySetUid)) {
      studyPrefetcherService.reportViewportDownloadProgress(displaySetUid, null);
      publishedDisplaySetUids.delete(displaySetUid);
    }
  });

  current.forEach(({ loaded, total, failed }, displaySetUid) => {
    studyPrefetcherService.reportViewportDownloadProgress(displaySetUid, { loaded, total, failed });
    publishedDisplaySetUids.add(displaySetUid);
  });
}

function scheduleProgressPublish(): void {
  if (!progressPublishTimer) {
    progressPublishTimer = setTimeout(publishProgress, PROGRESS_PUBLISH_INTERVAL_MS);
  }
}

function notify(viewportIds: Iterable<string>): void {
  if (Array.from(viewportIds).length) {
    scheduleProgressPublish();
  }
}

function updateStatus(clip: ClipState): void {
  if (clip.downloadedCount >= clip.imageIds.length) {
    clip.status = 'ready';
    return;
  }

  const hasPending = clip.downloaded.some(
    (isDownloaded, index) => !isDownloaded && !clip.failed.has(index)
  );

  clip.status = !hasPending && clip.inFlight.size === 0 ? 'error' : 'loading';
}

function markReady(clip: ClipState, index: number): void {
  if (!clip.ready[index]) {
    clip.ready[index] = true;
    clip.loaded += 1;
  }
  if (!clip.downloaded[index]) {
    clip.downloaded[index] = true;
    clip.downloadedCount += 1;
  }
  downloadedImageIds.add(clip.imageIds[index]);
  clip.failed.delete(index);
  clip.attempts.delete(index);
  clip.evictions.delete(index);
}

/** Frame the tile shows / plays next (cine playhead while playing). */
function getViewerFrameIndex(viewportId: string, total: number): number {
  const playhead = getCinePlayhead(viewportId);
  if (playhead && playhead.total === total) {
    return playhead.index;
  }
  try {
    const viewport = getAliveViewport(
      boundServicesManager?.services?.cornerstoneViewportService,
      viewportId
    );
    const index = viewport?.getCurrentImageIdIndex?.();
    return Number.isFinite(index) ? Number(index) : 0;
  } catch {
    return 0;
  }
}

/** How many frames until each frame of the clip plays again (smallest over its tiles). */
function getFramesUntilNeeded(clip: ClipState): number[] {
  const total = clip.imageIds.length;
  const distances = new Array<number>(total).fill(total);
  clip.viewers.forEach(viewportId => {
    const at = getViewerFrameIndex(viewportId, total);
    for (let index = 0; index < total; index += 1) {
      const distance = (index - at + total) % total;
      if (distance < distances[index]) {
        distances[index] = distance;
      }
    }
  });
  return distances;
}

let playheadPumpTimer: ReturnType<typeof setTimeout> | null = null;

/** The playhead moved on a clip with evicted frames: fetch the ones coming up. */
function onPlayheadMoved(viewportId: string): void {
  const clip = clips.get(clipKeyByViewport.get(viewportId) ?? '');
  if (!clip || clip.loaded >= clip.downloadedCount || playheadPumpTimer) {
    return;
  }
  playheadPumpTimer = setTimeout(() => {
    playheadPumpTimer = null;
    pump();
  }, PLAYHEAD_PUMP_INTERVAL_MS);
}

function onCacheImageRemoved(evt: Event): void {
  const imageId = (evt as CustomEvent)?.detail?.imageId;
  const keys = imageId ? clipKeysByImageId.get(imageId) : undefined;

  if (!keys) {
    return;
  }

  keys.forEach(key => {
    const clip = clips.get(key);
    const index = clip ? clip.imageIds.indexOf(imageId) : -1;

    if (!clip || index < 0 || !clip.ready[index]) {
      return;
    }

    clip.ready[index] = false;
    clip.loaded -= 1;
    updateStatus(clip);
    notify(clip.viewers);
  });

  pump();
}

/**
 * A frame decoded by someone else (thumbnail, study prefetch, a retry from the
 * study panel) counts for the clip too, including frames that had failed.
 */
function onImageLoaded(evt: Event): void {
  const detail = (evt as CustomEvent)?.detail;
  const imageId: string | undefined = detail?.image?.imageId ?? detail?.imageId;

  if (!imageId || !clipKeysByImageId.has(imageId)) {
    return;
  }

  // The cache entry can be filled just after the event fires.
  setTimeout(() => {
    let changed = false;

    clipKeysByImageId.get(imageId)?.forEach(key => {
      const clip = clips.get(key);
      const index = clip ? clip.imageIds.indexOf(imageId) : -1;

      if (!clip || index < 0 || clip.ready[index] || !isStackFrameReady(imageId)) {
        return;
      }

      markReady(clip, index);
      clip.retryAt.delete(index);
      updateStatus(clip);
      notify(clip.viewers);
      changed = true;
    });

    if (changed) {
      pump();
    }
  }, 0);
}

function bindCacheListener(): void {
  if (cacheListenerBound) {
    return;
  }

  eventTarget.addEventListener(EVENTS.IMAGE_CACHE_IMAGE_REMOVED, onCacheImageRemoved);
  eventTarget.addEventListener(EVENTS.IMAGE_LOADED, onImageLoaded);
  // Resume downloading frames evicted while the tab was hidden.
  subscribeMemoryState(() => {
    pump();
  });
  // Tab shown again or memory freed after a failure: clips that gave up start over.
  onMemoryRestore(() => {
    clips.forEach(clip => {
      if (clip.viewers.size && (clip.status === 'error' || clip.failed.size)) {
        clip.autoRetryRound = 0;
        resetClipFailures(clip);
        notify(clip.viewers);
      }
    });
    pump();
  });
  setProtectedImageIdsProvider(getVisibleClipFrameRanks);
  subscribeCinePlayhead(onPlayheadMoved);
  cacheListenerBound = true;
}

/** Frames of on-screen clips -> frames until they play again (evicted in reverse). */
function getVisibleClipFrameRanks(): Map<string, number> {
  const ranks = new Map<string, number>();
  clips.forEach(clip => {
    if (!clip.viewers.size) {
      return;
    }
    getFramesUntilNeeded(clip).forEach((distance, index) => {
      const imageId = clip.imageIds[index];
      const previous = ranks.get(imageId);
      ranks.set(imageId, previous == null ? distance : Math.min(previous, distance));
    });
  });
  return ranks;
}

function createClip(key: string, imageIds: string[]): ClipState {
  const ready = imageIds.map(imageId => isStackFrameReady(imageId));
  const loaded = ready.filter(Boolean).length;
  const downloaded = imageIds.map(
    (imageId, index) => ready[index] || downloadedImageIds.has(imageId)
  );
  imageIds.forEach((imageId, index) => {
    if (ready[index]) {
      downloadedImageIds.add(imageId);
    }
  });
  const clip: ClipState = {
    key,
    imageIds: [...imageIds],
    ready,
    loaded,
    downloaded,
    downloadedCount: downloaded.filter(Boolean).length,
    inFlight: new Set(),
    attempts: new Map(),
    evictions: new Map(),
    retryAt: new Map(),
    failed: new Set(),
    viewers: new Set(),
    status: 'loading',
    autoRetryRound: 0,
    autoRetryTimer: null,
  };

  updateStatus(clip);
  clips.set(key, clip);

  imageIds.forEach(imageId => {
    const keys = clipKeysByImageId.get(imageId) ?? new Set<string>();
    keys.add(key);
    clipKeysByImageId.set(imageId, keys);
  });

  bindCacheListener();

  return clip;
}

function loadFrame(clip: ClipState, index: number): void {
  const imageId = clip.imageIds[index];

  clip.inFlight.add(index);
  clip.retryAt.delete(index);
  totalInFlight += 1;

  let slotReleased = false;
  const releaseSlot = (): boolean => {
    if (slotReleased) {
      return false;
    }
    slotReleased = true;
    totalInFlight = Math.max(0, totalInFlight - 1);
    clip.inFlight.delete(index);
    return true;
  };

  const settle = () => {
    // Cleared on mode exit while this frame was in flight.
    if (clips.get(clip.key) !== clip) {
      pump();
      return;
    }

    updateStatus(clip);

    if (clip.status === 'error' || clip.failed.size) {
      scheduleAutoRetry(clip);
    }

    notify(clip.viewers);
    pump();
  };

  /** Not a failure: fetch again later without using up the frame's attempts. */
  const softRetry = (delayMs: number): boolean => {
    const refetches = (clip.evictions.get(index) ?? 0) + 1;
    clip.evictions.set(index, refetches);
    if (refetches > MAX_EVICTION_REFETCHES) {
      return false;
    }
    clip.retryAt.set(index, performance.now() + delayMs);
    return true;
  };

  const stallTimer = setTimeout(() => {
    if (!releaseSlot()) {
      return;
    }
    if (!clip.ready[index]) {
      softRetry(RETRY_BACKOFF_MS[0]);
    }
    dropPendingCacheEntry(imageId);
    settle();
  }, FRAME_LOAD_STALL_MS);

  Promise.resolve()
    .then(() =>
      imageLoader.loadAndCacheImage(imageId, {
        priority: 0,
        requestType: Enums.RequestType.Interaction,
      })
    )
    .then(() => {
      if (!isStackFrameReady(imageId)) {
        throw new FrameEvictedError();
      }
      markReady(clip, index);
    })
    .catch(error => {
      // The watchdog already rescheduled this frame.
      if (slotReleased) {
        return;
      }

      // Downloaded fine but dropped from a full cache before we looked: not a
      // failure, just fetch it again (from the persistent cache, usually).
      if (error instanceof FrameEvictedError && softRetry(EVICTION_REFETCH_DELAY_MS)) {
        return;
      }

      if (isMemoryRelatedLoadError(error)) {
        if (isOutOfMemoryError(error)) {
          relieveMemoryPressure('clip frame');
        }
        if (softRetry(MEMORY_REFETCH_DELAY_MS)) {
          return;
        }
      }

      const attempts = (clip.attempts.get(index) ?? 0) + 1;
      clip.attempts.set(index, attempts);

      if (attempts >= MAX_ATTEMPTS) {
        clip.failed.add(index);
      } else {
        clip.retryAt.set(index, performance.now() + RETRY_BACKOFF_MS[attempts - 1]);
      }
    })
    .finally(() => {
      clearTimeout(stallTimer);
      if (!releaseSlot()) {
        // Arrived after the watchdog gave up on it; still counts if it is decoded.
        if (clips.get(clip.key) === clip) {
          updateStatus(clip);
          notify(clip.viewers);
        }
        return;
      }
      settle();
    });
}

function resetClipFailures(clip: ClipState): void {
  clip.failed.clear();
  clip.attempts.clear();
  clip.evictions.clear();
  clip.retryAt.clear();
  updateStatus(clip);
}

function scheduleAutoRetry(clip: ClipState): void {
  if (clip.autoRetryTimer) {
    return;
  }

  const delay =
    AUTO_RETRY_DELAYS_MS[Math.min(clip.autoRetryRound, AUTO_RETRY_DELAYS_MS.length - 1)];

  clip.autoRetryTimer = setTimeout(() => {
    clip.autoRetryTimer = null;
    clip.autoRetryRound += 1;

    if (clips.get(clip.key) !== clip || (clip.status !== 'error' && !clip.failed.size)) {
      return;
    }

    // Off screen: retry when a tile shows the clip again (attach resets failures).
    if (!clip.viewers.size) {
      return;
    }

    resetClipFailures(clip);
    notify(clip.viewers);
    pump();
  }, delay);
}

function hasPendingThumbnailRequests(): boolean {
  try {
    const type = Enums.RequestType.Thumbnail;
    const queued = Object.values(imageLoadPoolManager.getRequestPool()?.[type] ?? {}).some(
      requests => Array.isArray(requests) && requests.length > 0
    );
    const inFlight =
      (imageLoadPoolManager as unknown as { numRequests?: Record<string, number> }).numRequests?.[
        type
      ] ?? 0;

    return queued || inFlight > 0;
  } catch {
    return false;
  }
}

/**
 * Total request budget for clips right now. While thumbnails are loading each
 * visible clip gets a single slot (enough for its frame 1); full speed after.
 */
function getClipRequestBudget(activeClipCount: number, now: number): number {
  if (!activeClipCount || !hasPendingThumbnailRequests()) {
    thumbnailsWaitStartedAt = null;
    return MAX_IN_FLIGHT_TOTAL;
  }

  thumbnailsWaitStartedAt ??= now;

  if (now - thumbnailsWaitStartedAt >= THUMBNAILS_FIRST_MAX_WAIT_MS) {
    return MAX_IN_FLIGHT_TOTAL;
  }

  if (!thumbnailsRecheckTimer) {
    thumbnailsRecheckTimer = setTimeout(() => {
      thumbnailsRecheckTimer = null;
      pump();
    }, THUMBNAILS_RECHECK_MS);
  }

  return Math.min(MAX_IN_FLIGHT_TOTAL, activeClipCount);
}

function scheduleRetry(at: number): void {
  if (retryTimer) {
    clearTimeout(retryTimer);
  }

  retryTimer = setTimeout(
    () => {
      retryTimer = null;
      pump();
    },
    Math.max(0, at - performance.now())
  );
}

/**
 * Next frame to request, or -1 (reports the earliest pending retry):
 * evicted frames about to play first, then never-downloaded frames in order.
 */
function findNextFrame(clip: ClipState, now: number, onRetryPending: (at: number) => void): number {
  const total = clip.imageIds.length;
  const canRequest = (index: number): boolean => {
    if (clip.ready[index] || clip.inFlight.has(index) || clip.failed.has(index)) {
      return false;
    }
    const retryAt = clip.retryAt.get(index);
    if (retryAt != null && retryAt > now) {
      onRetryPending(retryAt);
      return false;
    }
    return true;
  };

  if (clip.loaded < clip.downloadedCount) {
    for (const viewportId of clip.viewers) {
      const at = getViewerFrameIndex(viewportId, total);
      const lookahead = Math.min(total, PLAYHEAD_LOOKAHEAD_FRAMES);
      for (let step = 0; step < lookahead; step += 1) {
        const index = (at + step) % total;
        if (clip.downloaded[index] && canRequest(index)) {
          return index;
        }
      }
    }
  }

  for (let index = 0; index < total; index += 1) {
    if (!clip.downloaded[index] && canRequest(index)) {
      return index;
    }
  }

  return -1;
}

function isAnyVisibleClipDownloading(): boolean {
  for (const clip of clips.values()) {
    if (clip.viewers.size && clip.status === 'loading') {
      return true;
    }
  }

  return false;
}

/**
 * Background study prefetch competes for the same connections; hold it while
 * any visible clip is still downloading and resume once they are all ready.
 */
function updateBackgroundPrefetchPause(): void {
  // A hidden tab that gave its memory back must not refill it in the background.
  const shouldPause = isMemoryTrimmedForHiddenTab() || isAnyVisibleClipDownloading();

  if (shouldPause === backgroundPrefetchPaused) {
    return;
  }

  backgroundPrefetchPaused = shouldPause;

  try {
    boundServicesManager?.services?.studyPrefetcherService?.setPaused?.(shouldPause);
  } catch {
    // Prefetcher not registered in this mode.
  }
}

/**
 * Fill free request slots round-robin across visible clips (one frame per clip
 * per round), so every tile in the layout progresses together. Each clip first
 * gets an equal share of the total; slots left over (fewer active clips) are
 * handed out up to the per-clip cap.
 */
function pump(): void {
  // A hidden tab keeps only on-screen frames; downloading more would just be evicted again.
  if (isMemoryTrimmedForHiddenTab()) {
    updateBackgroundPrefetchPause();
    return;
  }

  const now = performance.now();
  let nextRetryAt = Infinity;
  const onRetryPending = (at: number) => {
    nextRetryAt = Math.min(nextRetryAt, at);
  };
  const activeClips = Array.from(clips.values()).filter(
    clip => clip.viewers.size && (clip.status !== 'ready' || clip.loaded < clip.imageIds.length)
  );

  if (activeClips.length) {
    const budget = getClipRequestBudget(activeClips.length, now);
    const fairShare = Math.max(
      1,
      Math.min(MAX_IN_FLIGHT_PER_CLIP, Math.floor(budget / activeClips.length))
    );

    for (const perClipLimit of [fairShare, MAX_IN_FLIGHT_PER_CLIP]) {
      let progressed = true;

      while (progressed && totalInFlight < budget) {
        progressed = false;

        for (const clip of activeClips) {
          if (totalInFlight >= budget) {
            break;
          }

          if (clip.inFlight.size >= perClipLimit) {
            continue;
          }

          const index = findNextFrame(clip, now, onRetryPending);

          if (index >= 0) {
            loadFrame(clip, index);
            progressed = true;
          }
        }
      }
    }
  }

  if (Number.isFinite(nextRetryAt)) {
    scheduleRetry(nextRetryAt);
  }

  updateBackgroundPrefetchPause();
}

function releaseViewportClip(viewportId: string): void {
  const key = clipKeyByViewport.get(viewportId);

  clipKeyByViewport.delete(viewportId);
  displaySetByViewport.delete(viewportId);

  if (!key) {
    return;
  }

  clips.get(key)?.viewers.delete(viewportId);
  notify([viewportId]);
  updateBackgroundPrefetchPause();
}

/**
 * Attach the viewport to its clip (starting downloads if needed) and report
 * whether every frame is decoded. Cheap enough to call from the cine ticker.
 */
function ensureViewportClipBuffered(viewportId: string, imageIds: string[]): boolean {
  if (!viewportId || !imageIds?.length) {
    return false;
  }

  const key = getClipKey(imageIds);

  if (blockedKeyByViewport.get(viewportId)?.key === key) {
    return false;
  }

  if (clipKeyByViewport.get(viewportId) !== key) {
    const previousKey = clipKeyByViewport.get(viewportId);

    if (previousKey) {
      clips.get(previousKey)?.viewers.delete(viewportId);
    }

    const clip = clips.get(key) ?? createClip(key, imageIds);
    clip.viewers.add(viewportId);
    clipKeyByViewport.set(viewportId, key);

    // Coming back to a clip that gave up earlier (e.g. network was down): try again.
    if (clip.status === 'error') {
      clip.autoRetryRound = 0;
      resetClipFailures(clip);
    }

    notify([viewportId]);
    pump();
  }

  return clips.get(key)?.status === 'ready';
}

/** True while this viewport's clip is still downloading (not ready, not settled). */
function isViewportClipBuffering(viewportId: string): boolean {
  return clips.get(clipKeyByViewport.get(viewportId) ?? '')?.status === 'loading';
}

function getViewportClipProgress(viewportId: string): ClipBufferProgress | null {
  const clip = clips.get(clipKeyByViewport.get(viewportId) ?? '');

  if (!clip) {
    return null;
  }

  return {
    status: clip.status,
    loaded: clip.downloadedCount,
    total: clip.imageIds.length,
    failed: clip.failed.size,
  };
}

function isUsClipViewport(servicesManager: AppTypes.ServicesManager, viewportId: string): boolean {
  const { displaySetService, viewportGridService } = servicesManager.services;
  const viewportState = viewportGridService.getState()?.viewports?.get(viewportId);

  return isUsMultiframeDisplaySet(getCineDisplaySetFromViewport(displaySetService, viewportState));
}

function syncViewportClip(servicesManager: AppTypes.ServicesManager, viewportId: string): void {
  const { displaySetService, viewportGridService, cornerstoneViewportService } =
    servicesManager.services;
  const viewportState = viewportGridService.getState()?.viewports?.get(viewportId);
  const displaySet = getCineDisplaySetFromViewport(displaySetService, viewportState);

  blockedKeyByViewport.delete(viewportId);

  if (!isUsMultiframeDisplaySet(displaySet)) {
    releaseViewportClip(viewportId);
    return;
  }

  const imageIds = getAliveViewport(cornerstoneViewportService, viewportId)?.getImageIds?.() ?? [];

  if (imageIds.length <= 1) {
    return;
  }

  ensureViewportClipBuffered(viewportId, imageIds);
  displaySetByViewport.set(viewportId, displaySet.displaySetInstanceUID);
  scheduleProgressPublish();
}

function initUsClipBuffering(servicesManager: AppTypes.ServicesManager): void {
  const { cornerstoneViewportService, viewportGridService } = servicesManager.services;

  boundServicesManager = servicesManager;

  cornerstoneViewportService.subscribe(
    cornerstoneViewportService.EVENTS.VIEWPORT_DATA_CHANGED,
    ({ viewportId }) => {
      if (viewportId) {
        syncViewportClip(servicesManager, viewportId);
      }
    }
  );

  // Page / layout change: stop downloading clips whose tile now shows a
  // different instance. The new stack attaches on VIEWPORT_DATA_CHANGED.
  viewportGridService.subscribe(viewportGridService.EVENTS.GRID_STATE_CHANGED, () => {
    const { viewports } = viewportGridService.getState();

    // A tile can get the same instance back (layout round-trip, protocol
    // re-apply) without a new VIEWPORT_DATA_CHANGED; keeping it blocked would
    // freeze that tile with no progress shown.
    Array.from(blockedKeyByViewport.entries()).forEach(([viewportId, blocked]) => {
      const uids = viewports?.get(viewportId)?.displaySetInstanceUIDs ?? [];

      if (blocked.displaySetUid && uids.includes(blocked.displaySetUid)) {
        blockedKeyByViewport.delete(viewportId);
      }
    });

    Array.from(clipKeyByViewport.keys()).forEach(viewportId => {
      const uids = viewports?.get(viewportId)?.displaySetInstanceUIDs ?? [];
      const attachedUid = displaySetByViewport.get(viewportId);

      if (!viewports?.has(viewportId) || (attachedUid && !uids.includes(attachedUid))) {
        const key = clipKeyByViewport.get(viewportId);

        if (key) {
          blockedKeyByViewport.set(viewportId, { key, displaySetUid: attachedUid ?? null });
        }
        releaseViewportClip(viewportId);
      }
    });
  });
}

function clearClipBuffers(): void {
  const viewportIds = Array.from(clipKeyByViewport.keys());

  clips.forEach(clip => {
    if (clip.autoRetryTimer) {
      clearTimeout(clip.autoRetryTimer);
    }
  });

  if (thumbnailsRecheckTimer) {
    clearTimeout(thumbnailsRecheckTimer);
    thumbnailsRecheckTimer = null;
  }
  thumbnailsWaitStartedAt = null;

  clips.clear();
  clipKeyByViewport.clear();
  displaySetByViewport.clear();
  blockedKeyByViewport.clear();
  clipKeysByImageId.clear();
  downloadedImageIds.clear();

  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }

  notify(viewportIds);
  updateBackgroundPrefetchPause();
}

/**
 * True when the frame is decoded now, or was downloaded before and is only
 * reloading after an eviction: the tile keeps its last picture instead of
 * showing an empty frame.
 */
function canShowClipFrame(imageId: string | undefined): boolean {
  return Boolean(imageId) && (isStackFrameReady(imageId) || downloadedImageIds.has(imageId));
}

export {
  canShowClipFrame,
  clearClipBuffers,
  ensureViewportClipBuffered,
  getViewportClipProgress,
  initUsClipBuffering,
  isUsClipViewport,
  isViewportClipBuffering,
  releaseViewportClip,
};
