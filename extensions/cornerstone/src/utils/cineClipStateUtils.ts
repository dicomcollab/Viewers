import { utilities as csToolsUtils } from '@cornerstonejs/tools';

type CustomClipState = {
  intervalId: ReturnType<typeof setInterval>;
  element: HTMLElement;
  viewportId?: string;
};

const clipsByElement = new Map<HTMLElement, CustomClipState>();
const clipsByViewportId = new Map<string, CustomClipState>();

function clearClipState(clip: CustomClipState | undefined): void {
  if (!clip) {
    return;
  }

  clearInterval(clip.intervalId);
  clipsByElement.delete(clip.element);

  if (clip.viewportId) {
    clipsByViewportId.delete(clip.viewportId);
  }
}

function setCustomClip(
  element: HTMLElement,
  intervalId: ReturnType<typeof setInterval>,
  viewportId?: string
): void {
  if (viewportId) {
    clearCustomClipByViewportId(viewportId);
  }

  clearCustomClip(element);

  const clip: CustomClipState = { intervalId, element, viewportId };
  clipsByElement.set(element, clip);

  if (viewportId) {
    clipsByViewportId.set(viewportId, clip);
  }
}

function clearCustomClip(element: HTMLElement | null | undefined): void {
  if (!element) {
    return;
  }

  clearClipState(clipsByElement.get(element));
}

function clearCustomClipByViewportId(viewportId?: string): void {
  if (!viewportId) {
    return;
  }

  clearClipState(clipsByViewportId.get(viewportId));
}

function hasCustomClip(element: HTMLElement | null | undefined, viewportId?: string): boolean {
  if (viewportId && clipsByViewportId.has(viewportId)) {
    return true;
  }

  return Boolean(element && clipsByElement.has(element));
}

/**
 * True when our live stack cine (or Cornerstone cine) is actually ticking.
 */
function isCineClipRunning(
  element: HTMLElement | null | undefined,
  viewportId?: string
): boolean {
  if (hasCustomClip(element, viewportId)) {
    return true;
  }

  try {
    if (viewportId && typeof csToolsUtils.cine?.getToolStateByViewportId === 'function') {
      const byId = csToolsUtils.cine.getToolStateByViewportId(viewportId);

      if (byId?.intervalId != null) {
        return true;
      }
    }

    if (!element) {
      return false;
    }

    const data = csToolsUtils.cine?.getToolState?.(element);

    return data?.intervalId != null;
  } catch {
    return false;
  }
}

export {
  clearCustomClip,
  clearCustomClipByViewportId,
  isCineClipRunning,
  setCustomClip,
};
