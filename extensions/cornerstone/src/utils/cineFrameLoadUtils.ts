import { cache, imageLoader, imageLoadPoolManager, Enums } from '@cornerstonejs/core';

const PREFETCH_AHEAD = 6;
const PREFETCH_AHEAD_MAX = 24;
/** Bind-time wait for the target frame before setStack; after this we bind anyway. */
const BIND_FRAME_WAIT_MS = 20000;
/**
 * A queued request can be dropped from the pool (clearRequestStack on mode exit,
 * page change) without its finally() ever running. Re-queue after this so a frame
 * the cine is waiting on is never blocked forever by a stale marker.
 */
const QUEUED_FRAME_STALE_MS = 15000;
/** Cornerstone StackViewport uses -5 for the frame it is displaying; stay just behind it. */
const NEXT_FRAME_PRIORITY = -4;

const queuedFrameRequests = new Map<string, number>();

function getPrefetchCount(periodMs?: number): number {
  if (periodMs == null || !Number.isFinite(periodMs) || periodMs <= 0) {
    return PREFETCH_AHEAD;
  }

  const fps = 1000 / periodMs;
  // Prefetch roughly half a second ahead so high FPS does not stall on decode.
  return Math.min(PREFETCH_AHEAD_MAX, Math.max(PREFETCH_AHEAD, Math.ceil(fps * 0.5)));
}

function isStackFrameReady(imageId: string | undefined): boolean {
  if (!imageId) {
    return false;
  }

  try {
    const image = cache.getImage(imageId);
    if (!image) {
      return false;
    }

    // A cache stub without pixels is not playable — advancing cine on it
    // moves the bar while the canvas stays on the last real frame.
    if (typeof image.getPixelData === 'function') {
      const pixelData = image.getPixelData();
      return Boolean(pixelData && pixelData.length);
    }

    return true;
  } catch {
    return false;
  }
}

function isStackFrameInFlight(imageId: string): boolean {
  try {
    return Boolean(cache.getImageLoadObject(imageId));
  } catch {
    return false;
  }
}

/**
 * Queue a frame through imageLoadPoolManager (Interaction type, so stack prefetch
 * filtering never drops it). Lower priority numbers load first, so callers pass
 * the frame's distance from the playhead to keep downloads in playback order.
 */
function prefetchStackFrame(imageId: string | undefined, priority = NEXT_FRAME_PRIORITY): void {
  if (!imageId || isStackFrameReady(imageId) || isStackFrameInFlight(imageId)) {
    return;
  }

  const now = performance.now();
  const queuedAt = queuedFrameRequests.get(imageId);

  if (queuedAt != null && now - queuedAt < QUEUED_FRAME_STALE_MS) {
    return;
  }

  queuedFrameRequests.set(imageId, now);

  const requestType = Enums.RequestType.Interaction;
  const request = () => {
    if (isStackFrameReady(imageId)) {
      queuedFrameRequests.delete(imageId);
      return Promise.resolve();
    }

    return Promise.resolve()
      .then(() => imageLoader.loadAndCacheImage(imageId, { priority, requestType }))
      .catch(() => undefined)
      .finally(() => {
        queuedFrameRequests.delete(imageId);
      });
  };

  try {
    imageLoadPoolManager.addRequest(request, requestType, { imageId, cineFramePrefetch: true }, priority);
  } catch {
    queuedFrameRequests.delete(imageId);
  }
}

function prefetchUpcomingStackFrames(
  imageIds: string[],
  fromIndex: number,
  count = PREFETCH_AHEAD
): void {
  if (!imageIds?.length) {
    return;
  }

  const ahead = Math.max(1, Math.round(count) || PREFETCH_AHEAD);

  for (let i = 1; i <= ahead; i += 1) {
    prefetchStackFrame(imageIds[(fromIndex + i) % imageIds.length], NEXT_FRAME_PRIORITY + i);
  }
}

/**
 * Resolve once `imageId` is decoded in cache, or `timeoutMs` elapses. Never
 * rejects — on failure the caller binds anyway and Cornerstone surfaces the
 * load error through the normal IMAGE_LOAD_ERROR path.
 */
function ensureStackFrameLoaded(
  imageId: string | undefined,
  timeoutMs = BIND_FRAME_WAIT_MS
): Promise<boolean> {
  if (!imageId) {
    return Promise.resolve(false);
  }

  if (isStackFrameReady(imageId)) {
    return Promise.resolve(true);
  }

  let timerId: ReturnType<typeof setTimeout> | undefined;

  const load = Promise.resolve()
    .then(() =>
      imageLoader.loadAndCacheImage(imageId, {
        priority: NEXT_FRAME_PRIORITY,
        requestType: Enums.RequestType.Interaction,
      })
    )
    .then(
      () => isStackFrameReady(imageId),
      () => false
    );

  const timeout = new Promise<boolean>(resolve => {
    timerId = setTimeout(() => resolve(false), timeoutMs);
  });

  return Promise.race([load, timeout]).finally(() => {
    if (timerId) {
      clearTimeout(timerId);
    }
  });
}

function pickSafeStackBindIndex(
  imageIds: string[] | undefined,
  preferredIndex?: number | null,
  { allowAnyReadyFallback = true }: { allowAnyReadyFallback?: boolean } = {}
): number {
  if (!imageIds?.length) {
    return 0;
  }

  const last = imageIds.length - 1;
  const preferred =
    preferredIndex != null && Number.isFinite(preferredIndex)
      ? Math.max(0, Math.min(last, Math.round(preferredIndex)))
      : 0;

  if (isStackFrameReady(imageIds[preferred])) {
    return preferred;
  }

  if (isStackFrameReady(imageIds[0])) {
    return 0;
  }

  // US cine must not open on whichever frame happens to be cached (the study
  // browser thumbnail decodes the middle frame), or playback and prefetch start mid-loop.
  if (!allowAnyReadyFallback) {
    return preferred;
  }

  const firstReady = imageIds.findIndex(imageId => isStackFrameReady(imageId));
  return firstReady >= 0 ? firstReady : 0;
}

export {
  ensureStackFrameLoaded,
  getPrefetchCount,
  isStackFrameReady,
  pickSafeStackBindIndex,
  prefetchStackFrame,
  prefetchUpcomingStackFrames,
};
