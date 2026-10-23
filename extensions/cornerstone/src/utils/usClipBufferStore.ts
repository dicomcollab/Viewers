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
import { isInitialFramesPhase, subscribeInitialFramesPhase } from './viewportDemandCoordinator';
import { selectNextClipFrame } from './selectNextClipFrame';

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
  /** Cached playhead distances; invalidated when a viewer playhead moves. */
  rankCache: { signature: string; distances: number[] } | null;
};

/**
 * Cap when few clips are active; with 4 visible clips each gets 6 / 4 = 1–2.
 * Overridable with appConfig.usClipBuffer { maxInFlightPerClip, maxInFlightTotal }.
 * Defaults stay at/under HTTP/1.1's ~6 connections per host (original DICOM).
 */
let MAX_IN_FLIGHT_PER_CLIP = 3;
let MAX_IN_FLIGHT_TOTAL = 6;
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
 * whole loop over and over. Keep this small: 4 large echo clips already fill
 * the decode cache, and a long lookahead turns into constant network thrash.
 */
const PLAYHEAD_LOOKAHEAD_FRAMES = 10;
/** Once every frame has been downloaded once, fewer slots are enough to refill. */
const MAX_IN_FLIGHT_PER_CLIP_WHEN_READY = 2;
/**
 * While any on-screen cine is playing, keep clip downloads small so decode and
 * paint stay ahead of the playhead (otherwise playback slides/stutters until
 * the background download finishes).
 */
const MAX_IN_FLIGHT_TOTAL_WHILE_PLAYING = 2;
const MAX_IN_FLIGHT_PER_CLIP_WHILE_PLAYING = 1;
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

/**
 * Drop a cache entry that is not decoded yet so the next request starts a
 * fresh download. A hung load object would otherwise be reused forever and
 * the frame would never finish.
 */
function dropPendingCacheEntry(imageId: string): void {
  try {
    if (!isStackFrameReady(imageId)) {
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
  const viewerIndexes: number[] = [];
  clip.viewers.forEach(viewportId => {
    viewerIndexes.push(getViewerFrameIndex(viewportId, total));
  });
  const signature = `${total}|${viewerIndexes.join(',')}`;
  if (clip.rankCache?.signature === signature) {
    return clip.rankCache.distances;
  }

  const distances = new Array<number>(total).fill(total);
  viewerIndexes.forEach(at => {
    for (let index = 0; index < total; index += 1) {
      const distance = (index - at + total) % total;
      if (distance < distances[index]) {
        distances[index] = distance;
      }
    }
  });
  clip.rankCache = { signature, distances };
  return distances;
}

let playheadPumpTimer: ReturnType<typeof setTimeout> | null = null;

/** The playhead moved on a clip with evicted frames: fetch the ones coming up. */
function onPlayheadMoved(viewportId: string): void {
  const clip = clips.get(clipKeyByViewport.get(viewportId) ?? '');
  if (!clip) {
    return;
  }
  clip.rankCache = null;
  if (clip.loaded >= clip.downloadedCount || playheadPumpTimer) {
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
    rankCache: null,
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
      // Soft retry first; if eviction/hung-load retries are exhausted, count a
      // real attempt so the frame eventually fails and auto-retries instead of
      // spinning on the same slot forever.
      if (!softRetry(RETRY_BACKOFF_MS[0])) {
        const attempts = (clip.attempts.get(index) ?? 0) + 1;
        clip.attempts.set(index, attempts);
        if (attempts >= MAX_ATTEMPTS) {
          clip.failed.add(index);
        } else {
          clip.retryAt.set(index, performance.now() + RETRY_BACKOFF_MS[attempts - 1]);
        }
      }
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
 * While cine is playing, keep the budget small so paint stays smooth.
 */
function getClipRequestBudget(activeClipCount: number, now: number): number {
  const playing = isAnyVisibleCinePlaying();
  const cap = playing ? MAX_IN_FLIGHT_TOTAL_WHILE_PLAYING : MAX_IN_FLIGHT_TOTAL;

  // A page is still putting up its first images (single frames included):
  // one request per clip until it has, so they are not queued behind clip frames.
  if (activeClipCount && isInitialFramesPhase()) {
    return Math.min(cap, activeClipCount);
  }

  if (!activeClipCount || !hasPendingThumbnailRequests()) {
    thumbnailsWaitStartedAt = null;
    return cap;
  }

  thumbnailsWaitStartedAt ??= now;

  if (now - thumbnailsWaitStartedAt >= THUMBNAILS_FIRST_MAX_WAIT_MS) {
    return cap;
  }

  if (!thumbnailsRecheckTimer) {
    thumbnailsRecheckTimer = setTimeout(() => {
      thumbnailsRecheckTimer = null;
      pump();
    }, THUMBNAILS_RECHECK_MS);
  }

  return Math.min(cap, activeClipCount);
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

/** Next frame to request, or -1 (reports the earliest pending retry). */
function findNextFrame(clip: ClipState, now: number, onRetryPending: (at: number) => void): number {
  const total = clip.imageIds.length;
  const viewerIndexes = Array.from(clip.viewers, viewportId =>
    getViewerFrameIndex(viewportId, total)
  );
  return selectNextClipFrame(clip, viewerIndexes, now, onRetryPending, PLAYHEAD_LOOKAHEAD_FRAMES);
}

/**
 * True while a visible clip has not finished its first-pass download yet
 * (every frame downloaded at least once). Playhead refill after eviction must
 * not keep study prefetch paused forever — that froze the study download count
 * at the first layout's total (e.g. stuck at 617 after four clips finished).
 */
function isAnyVisibleClipFirstPassIncomplete(): boolean {
  for (const clip of clips.values()) {
    if (!clip.viewers.size) {
      continue;
    }
    if (clip.downloadedCount < clip.imageIds.length) {
      return true;
    }
  }

  return false;
}

/** True when any on-screen clip viewport is actively playing cine. */
function isAnyVisibleCinePlaying(): boolean {
  const cines = boundServicesManager?.services?.cineService?.getState?.()?.cines;
  if (!cines) {
    return false;
  }
  for (const clip of clips.values()) {
    for (const viewportId of clip.viewers) {
      if (cines[viewportId]?.isPlaying) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Hold study prefetch only while the current layout's clips are still on their
 * first download. While cine is playing, keep prefetch in "smooth" mode (one
 * request) so already-downloaded tiles stay fluid.
 */
function updateBackgroundPrefetchPause(): void {
  // A hidden tab that gave its memory back must not refill it in the background.
  const shouldPause = isMemoryTrimmedForHiddenTab() || isAnyVisibleClipFirstPassIncomplete();
  const cinePlaying = !shouldPause && isAnyVisibleCinePlaying();

  if (shouldPause !== backgroundPrefetchPaused) {
    backgroundPrefetchPaused = shouldPause;

    try {
      boundServicesManager?.services?.studyPrefetcherService?.setPaused?.(
        shouldPause,
        'visibleClips'
      );
    } catch {
      // Prefetcher not registered in this mode.
    }
  }

  try {
    boundServicesManager?.services?.studyPrefetcherService?.setSmoothPlaybackMode?.(cinePlaying);
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
    const cinePlaying = isAnyVisibleCinePlaying();
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

          // Fully downloaded clips only refill the playhead window — do not let
          // them monopolize every connection and starve first-pass downloads or
          // make cine stutter while re-fetching 30 frames ahead forever.
          // While playing, one in-flight per clip is enough for the warm window.
          const readyCap = cinePlaying
            ? MAX_IN_FLIGHT_PER_CLIP_WHILE_PLAYING
            : MAX_IN_FLIGHT_PER_CLIP_WHEN_READY;
          const clipLimit =
            clip.status === 'ready' && clip.downloadedCount >= clip.imageIds.length
              ? Math.min(perClipLimit, readyCap)
              : cinePlaying
                ? Math.min(perClipLimit, MAX_IN_FLIGHT_PER_CLIP_WHILE_PLAYING)
                : perClipLimit;

          if (clip.inFlight.size >= clipLimit) {
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

  const clip = clips.get(key);
  if (clip) {
    clip.viewers.delete(viewportId);
    clip.rankCache = null;
  }
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
      const previous = clips.get(previousKey);
      if (previous) {
        previous.viewers.delete(viewportId);
        previous.rankCache = null;
      }
    }

    const clip = clips.get(key) ?? createClip(key, imageIds);
    clip.viewers.add(viewportId);
    clip.rankCache = null;
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

/** Download state of the clip a tile is attached to, for console diagnostics. */
function getViewportClipDebugInfo(viewportId: string, imageIds: string[] = []) {
  const key = clipKeyByViewport.get(viewportId) ?? null;
  const clip = key ? clips.get(key) : undefined;

  const pendingNew = clip
    ? clip.downloaded.reduce((count, isDownloaded, index) => {
        if (isDownloaded || clip.failed.has(index) || clip.inFlight.has(index)) {
          return count;
        }
        return count + 1;
      }, 0)
    : 0;

  return {
    attached: Boolean(clip),
    attachedToShownStack: Boolean(key) && imageIds.length > 1 && key === getClipKey(imageIds),
    blocked: blockedKeyByViewport.has(viewportId),
    status: clip?.status ?? null,
    decoded: clip?.loaded ?? 0,
    downloaded: clip?.downloadedCount ?? 0,
    pendingNew,
    total: clip?.imageIds.length ?? 0,
    inFlight: clip?.inFlight.size ?? 0,
    failed: clip?.failed.size ?? 0,
    viewers: clip ? Array.from(clip.viewers) : [],
    totalInFlight,
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

function configureUsClipBuffer(config?: {
  maxInFlightPerClip?: number;
  maxInFlightTotal?: number;
}): void {
  const perClip = Math.floor(Number(config?.maxInFlightPerClip));
  const total = Math.floor(Number(config?.maxInFlightTotal));

  if (perClip > 0) {
    MAX_IN_FLIGHT_PER_CLIP = perClip;
  }
  if (total > 0) {
    MAX_IN_FLIGHT_TOTAL = total;
  }
}

function initUsClipBuffering(servicesManager: AppTypes.ServicesManager): void {
  const { cornerstoneViewportService, viewportGridService, cineService } =
    servicesManager.services;

  boundServicesManager = servicesManager;

  // Full request budget again once the page's first images are up.
  subscribeInitialFramesPhase(active => {
    if (!active) {
      pump();
    }
  });

  // Play / pause: raise or lower download pressure so on-screen cine stays smooth.
  cineService?.subscribe?.(cineService.EVENTS.CINE_STATE_CHANGED, () => {
    updateBackgroundPrefetchPause();
    pump();
  });

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

/**
 * Every attempt to download the frame failed: playback may pass over it (as an
 * empty frame) instead of waiting for it.
 */
function isClipFrameFailed(imageId: string | undefined): boolean {
  if (!imageId) {
    return false;
  }
  const keys = clipKeysByImageId.get(imageId);
  if (!keys) {
    return false;
  }
  for (const key of keys) {
    const clip = clips.get(key);
    const index = clip ? clip.imageIds.indexOf(imageId) : -1;
    if (clip && index >= 0 && clip.failed.has(index)) {
      return true;
    }
  }
  return false;
}

/** Totals for diagnostics (no image ids). */
function getClipBufferStats() {
  let visibleClips = 0;
  let decoded = 0;
  let frames = 0;
  let failed = 0;
  clips.forEach(clip => {
    if (!clip.viewers.size) {
      return;
    }
    visibleClips += 1;
    decoded += clip.loaded;
    frames += clip.imageIds.length;
    failed += clip.failed.size;
  });
  return {
    clips: clips.size,
    visibleClips,
    visibleFramesDecoded: decoded,
    visibleFramesTotal: frames,
    visibleFramesFailed: failed,
    inFlight: totalInFlight,
    maxInFlightTotal: MAX_IN_FLIGHT_TOTAL,
    maxInFlightPerClip: MAX_IN_FLIGHT_PER_CLIP,
  };
}

export {
  canShowClipFrame,
  clearClipBuffers,
  configureUsClipBuffer,
  ensureViewportClipBuffered,
  getClipBufferStats,
  isClipFrameFailed,
  getViewportClipDebugInfo,
  getViewportClipProgress,
  initUsClipBuffering,
  isUsClipViewport,
  isViewportClipBuffering,
  releaseViewportClip,
};
