/**
 * Layout / hanging-protocol swaps destroy Cornerstone StackViewport instances
 * and recreate them under the same viewportId. Callers that keep a lexical
 * viewport reference (or use jumpToSlice with debounceLoading) then hit:
 *
 *   "The stack viewport has been destroyed and is no longer usable."
 *
 * Always re-fetch by id and skip disabled viewports so this never reaches production.
 */

import { Enums } from '@cornerstonejs/core';
import { isStackFrameReady, pickSafeStackBindIndex } from './cineFrameLoadUtils';

type SetViewportFrameOptions = {
  viewportId?: string;
  cornerstoneViewportService?: any;
  generation?: number;
  getGeneration?: () => number;
  isCurrent?: () => boolean;
  stackKey?: string | null;
};

function isViewportAlive(viewport: {
  isDisabled?: boolean;
  element?: HTMLElement;
} | null | undefined): boolean {
  return Boolean(viewport && !viewport.isDisabled && viewport.element);
}

function getAliveViewport(cornerstoneViewportService, viewportId: string) {
  if (!viewportId || !cornerstoneViewportService?.getCornerstoneViewport) {
    return null;
  }

  try {
    const viewport = cornerstoneViewportService.getCornerstoneViewport(viewportId);

    return isViewportAlive(viewport) ? viewport : null;
  } catch {
    return null;
  }
}

function getViewportFrameCount(viewport): number {
  if (!isViewportAlive(viewport) || typeof viewport.getImageIds !== 'function') {
    return 0;
  }

  try {
    return viewport.getImageIds()?.length ?? 0;
  } catch {
    return 0;
  }
}

function getViewportFrameIndex(viewport): number {
  if (!isViewportAlive(viewport) || typeof viewport.getCurrentImageIdIndex !== 'function') {
    return 0;
  }

  try {
    return viewport.getCurrentImageIdIndex() ?? 0;
  } catch {
    return 0;
  }
}

function getViewportStackKey(viewport): string | null {
  if (!isViewportAlive(viewport) || typeof viewport.getImageIds !== 'function') {
    return null;
  }

  try {
    return viewport.getImageIds()?.[0] ?? null;
  } catch {
    return null;
  }
}

function resolveLiveViewport(viewport, options?: SetViewportFrameOptions) {
  if (options?.viewportId && options?.cornerstoneViewportService) {
    return getAliveViewport(options.cornerstoneViewportService, options.viewportId) ?? viewport;
  }

  return viewport;
}

function isSetFrameStillValid(viewport, options?: SetViewportFrameOptions): boolean {
  if (options?.isCurrent && !options.isCurrent()) {
    return false;
  }

  if (options?.getGeneration && options.generation != null) {
    if (options.getGeneration() !== options.generation) {
      return false;
    }
  }

  if (!isViewportAlive(viewport)) {
    return false;
  }

  if (options?.stackKey) {
    return getViewportStackKey(viewport) === options.stackKey;
  }

  return true;
}

/**
 * Set the current stack frame on a live viewport. No-ops if the instance was
 * destroyed between lookup and call (layout change). Never uses debounced
 * jumpToSlice — that schedules setImageIdIndex on the old instance.
 */
function setViewportFrameIndex(viewport, imageIndex: number): boolean {
  if (!isViewportAlive(viewport) || typeof viewport.setImageIdIndex !== 'function') {
    return false;
  }

  const frameCount = getViewportFrameCount(viewport);

  if (frameCount <= 0) {
    return false;
  }

  const clamped = Math.max(0, Math.min(frameCount - 1, Math.round(imageIndex)));

  try {
    const current = getViewportFrameIndex(viewport);

    // Repeating setImageIdIndex on the same frame can cancel an in-flight
    // first render and leave a black canvas (reload then shows the image).
    if (current === clamped) {
      return true;
    }

    // Do not call render() here — setImageIdIndex already renders, and a second
    // render can paint the previous frame and cancel the in-flight swap.
    viewport.setImageIdIndex(clamped);

    return true;
  } catch {
    return false;
  }
}

/**
 * Wait until Cornerstone has applied the new stack image (load + set).
 * Used by cine so the next frame is not requested while this one is still swapping.
 *
 * Re-fetches the viewport by id and refuses the swap when paging has replaced
 * the stack or stopClip has bumped cine generation — otherwise setImageIdIndex
 * aborts the new first-frame retrieve (status 0) and leaves a black canvas.
 */
async function setViewportFrameIndexAsync(
  viewport,
  imageIndex: number,
  options?: SetViewportFrameOptions
): Promise<boolean> {
  const live = resolveLiveViewport(viewport, options);

  if (!isSetFrameStillValid(live, options) || typeof live.setImageIdIndex !== 'function') {
    return false;
  }

  const frameCount = getViewportFrameCount(live);

  if (frameCount <= 0) {
    return false;
  }

  const clamped = Math.max(0, Math.min(frameCount - 1, Math.round(imageIndex)));

  try {
    const imageIds =
      typeof live.getImageIds === 'function' ? live.getImageIds() ?? [] : [];

    if (!isStackFrameReady(imageIds[clamped])) {
      return false;
    }

    const current = getViewportFrameIndex(live);

    if (current === clamped) {
      return true;
    }

    const result = live.setImageIdIndex(clamped);

    if (result != null && typeof result.then === 'function') {
      await result;
    }

    const after = resolveLiveViewport(live, options);
    return isSetFrameStillValid(after, options);
  } catch {
    return false;
  }
}

function setViewportFrameIndexById(
  cornerstoneViewportService,
  viewportId: string,
  imageIndex: number
): boolean {
  return setViewportFrameIndex(getAliveViewport(cornerstoneViewportService, viewportId), imageIndex);
}

function recoverBlankStackViewport(cornerstoneViewportService, viewportId: string): boolean {
  const viewport = getAliveViewport(cornerstoneViewportService, viewportId);
  const frameCount = getViewportFrameCount(viewport);

  if (!viewport || frameCount < 1) {
    return false;
  }

  try {
    const imageIds =
      typeof viewport.getImageIds === 'function' ? viewport.getImageIds() ?? [] : [];
    const current = getViewportFrameIndex(viewport);
    const status = viewport.viewportStatus;
    const rendered =
      status == null ||
      Enums.ViewportStatus?.RENDERED == null ||
      status === Enums.ViewportStatus.RENDERED;
    const hasPixels = Boolean(viewport.csImage);
    const currentReady = isStackFrameReady(imageIds[current]);

    if (rendered && hasPixels && currentReady) {
      viewport.render?.();
      return true;
    }

    const firstReady = imageIds.findIndex(imageId => isStackFrameReady(imageId));
    const target = currentReady ? current : firstReady;

    if (target < 0) {
      viewport.resize?.();
      viewport.render?.();
      return false;
    }

    if (!hasPixels && typeof viewport.setStack === 'function') {
      const bindIndex = pickSafeStackBindIndex(imageIds, target);
      void Promise.resolve(viewport.setStack(imageIds, bindIndex)).catch(() => undefined);
      viewport.resize?.();
      return true;
    }

    if (typeof viewport.setImageIdIndex === 'function' && target !== current) {
      viewport.setImageIdIndex(target);
    } else {
      viewport.render?.();
    }

    viewport.resize?.();
    return true;
  } catch {
    return false;
  }
}

function recoverLayoutStackViewports(cornerstoneViewportService, viewportIds: string[]): void {
  (viewportIds || []).forEach(viewportId => {
    recoverBlankStackViewport(cornerstoneViewportService, viewportId);
  });
}

export {
  getAliveViewport,
  getViewportFrameCount,
  getViewportFrameIndex,
  getViewportStackKey,
  isViewportAlive,
  recoverBlankStackViewport,
  recoverLayoutStackViewports,
  setViewportFrameIndex,
  setViewportFrameIndexAsync,
  setViewportFrameIndexById,
};

