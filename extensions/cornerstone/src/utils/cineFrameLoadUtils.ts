import { cache, imageLoader } from '@cornerstonejs/core';

const PREFETCH_AHEAD = 6;

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

function prefetchStackFrame(imageId: string | undefined): void {
  if (!imageId || isStackFrameReady(imageId)) {
    return;
  }

  try {
    if (typeof imageLoader?.loadAndCacheImage === 'function') {
      void imageLoader.loadAndCacheImage(imageId);
    }
  } catch {
    // Duplicate request / already in flight.
  }
}

function prefetchUpcomingStackFrames(imageIds: string[], fromIndex: number, count = PREFETCH_AHEAD): void {
  if (!imageIds?.length) {
    return;
  }

  for (let i = 1; i <= count; i += 1) {
    prefetchStackFrame(imageIds[(fromIndex + i) % imageIds.length]);
  }
}

function pickSafeStackBindIndex(imageIds: string[] | undefined, preferredIndex?: number | null): number {
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

  const firstReady = imageIds.findIndex(imageId => isStackFrameReady(imageId));
  return firstReady >= 0 ? firstReady : 0;
}

export { isStackFrameReady, pickSafeStackBindIndex, prefetchStackFrame, prefetchUpcomingStackFrames };
