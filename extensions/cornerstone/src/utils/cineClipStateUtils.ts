import { utilities as csToolsUtils } from '@cornerstonejs/tools';

type CustomClipState = {
  intervalId: ReturnType<typeof setInterval>;
};

const customClips = new Map<HTMLElement, CustomClipState>();

function setCustomClip(
  element: HTMLElement,
  intervalId: ReturnType<typeof setInterval>
): void {
  customClips.set(element, { intervalId });
}

function clearCustomClip(element: HTMLElement | null | undefined): void {
  if (!element) {
    return;
  }

  const clip = customClips.get(element);

  if (!clip) {
    return;
  }

  clearInterval(clip.intervalId);
  customClips.delete(element);
}

function hasCustomClip(element: HTMLElement | null | undefined): boolean {
  return Boolean(element && customClips.has(element));
}

/**
 * True when Cornerstone cine (or the FR-step interval) is actually ticking.
 * `cines[id].isPlaying` can stay true after a layout swap even though the clip
 * died with the old viewport instance.
 */
function isCineClipRunning(
  element: HTMLElement | null | undefined,
  viewportId?: string
): boolean {
  if (hasCustomClip(element)) {
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

export { clearCustomClip, isCineClipRunning, setCustomClip };
