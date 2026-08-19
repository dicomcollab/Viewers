/**
 * Layout / hanging-protocol swaps destroy Cornerstone StackViewport instances
 * and recreate them under the same viewportId. Callers that keep a lexical
 * viewport reference (or use jumpToSlice with debounceLoading) then hit:
 *
 *   "The stack viewport has been destroyed and is no longer usable."
 *
 * Always re-fetch by id and skip disabled viewports so this never reaches production.
 */

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
    viewport.setImageIdIndex(clamped);
    return true;
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

export {
  getAliveViewport,
  getViewportFrameCount,
  getViewportFrameIndex,
  isViewportAlive,
  setViewportFrameIndex,
  setViewportFrameIndexById,
};
