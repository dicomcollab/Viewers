import { cache, imageLoader } from '@cornerstonejs/core';

const PREFETCH_AHEAD = 6;

function isStackFrameReady(imageId: string | undefined): boolean {
  if (!imageId) {
    return false;
  }

  try {
    return Boolean(cache.getImage(imageId));
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

export { isStackFrameReady, prefetchStackFrame, prefetchUpcomingStackFrames };
