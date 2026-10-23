import { utilities as csToolsUtils } from '@cornerstonejs/tools';
import { registerCineTick, unregisterCineTick } from './cineSharedTicker';

type CustomClipState = {
  tickId: string;
  element: HTMLElement;
  viewportId?: string;
};

const clipsByElement = new Map<HTMLElement, CustomClipState>();
const clipsByViewportId = new Map<string, CustomClipState>();

let cineGeneration = 0;
let tickSeq = 0;

function bumpCineGeneration(): number {
  cineGeneration += 1;
  return cineGeneration;
}

function getCineGeneration(): number {
  return cineGeneration;
}

function nextTickId(viewportId?: string): string {
  tickSeq += 1;
  return viewportId ? `vp:${viewportId}` : `el:${tickSeq}`;
}

function clearClipState(clip: CustomClipState | undefined): void {
  if (!clip) {
    return;
  }

  unregisterCineTick(clip.tickId);
  clipsByElement.delete(clip.element);

  if (clip.viewportId) {
    clipsByViewportId.delete(clip.viewportId);
  }
}

function setCustomClip(element: HTMLElement, tick: () => void, viewportId?: string): void {
  if (viewportId) {
    clearCustomClipByViewportId(viewportId);
  }

  clearCustomClip(element);

  const tickId = nextTickId(viewportId);
  registerCineTick(tickId, tick);

  const clip: CustomClipState = { tickId, element, viewportId };
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
    // getToolStateByViewportId only exists in some @cornerstonejs/tools versions.
    const cineUtils = csToolsUtils.cine as typeof csToolsUtils.cine & {
      getToolStateByViewportId?: (viewportId: string) => { intervalId?: unknown } | undefined;
    };

    if (viewportId && typeof cineUtils?.getToolStateByViewportId === 'function') {
      const byId = cineUtils.getToolStateByViewportId(viewportId);

      if (byId?.intervalId != null) {
        return true;
      }
    }

    if (!element) {
      return false;
    }

    const data = cineUtils?.getToolState?.(element);

    return data?.intervalId != null;
  } catch {
    return false;
  }
}

export {
  bumpCineGeneration,
  clearCustomClip,
  clearCustomClipByViewportId,
  getCineGeneration,
  isCineClipRunning,
  setCustomClip,
};
