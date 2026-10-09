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
import {
  ensureStackFrameLoaded,
  isStackFrameReady,
  pickSafeStackBindIndex,
  prefetchStackFrame,
} from './cineFrameLoadUtils';
import { isAwaitingFirstImage } from './viewportFirstImageStore';

type SetViewportFrameOptions = {
  viewportId?: string;
  cornerstoneViewportService?: any;
  generation?: number;
  getGeneration?: () => number;
  isCurrent?: () => boolean;
  stackKey?: string | null;
};

function isViewportAlive(
  viewport:
    | {
        isDisabled?: boolean;
        element?: HTMLElement;
      }
    | null
    | undefined
): boolean {
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

/**
 * True once the viewport has painted the first image of its current stack
 * and, unless `allowSwapInFlight`, no frame swap is pending. Calling
 * setImageIdIndex before that cancels the pending load and leaves the tile
 * black with only its overlay showing.
 */
function hasViewportPaintedFirstImage(
  viewport,
  { allowSwapInFlight = false }: { allowSwapInFlight?: boolean } = {}
): boolean {
  if (!isViewportAlive(viewport) || isAwaitingFirstImage(viewport.id)) {
    return false;
  }

  try {
    const image =
      typeof viewport.getCornerstoneImage === 'function'
        ? viewport.getCornerstoneImage()
        : viewport.csImage;

    if (!image) {
      return false;
    }
  } catch {
    return false;
  }

  if (allowSwapInFlight) {
    return true;
  }

  const status = viewport.viewportStatus;
  const rendered = Enums.ViewportStatus?.RENDERED;

  return status == null || rendered == null || status === rendered;
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
    const imageIds = typeof live.getImageIds === 'function' ? (live.getImageIds() ?? []) : [];

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
  return setViewportFrameIndex(
    getAliveViewport(cornerstoneViewportService, viewportId),
    imageIndex
  );
}

function recoverBlankStackViewport(cornerstoneViewportService, viewportId: string): boolean {
  const viewport = getAliveViewport(cornerstoneViewportService, viewportId);
  const frameCount = getViewportFrameCount(viewport);

  // A second setStack while the bind's first frame is loading cancels it.
  if (!viewport || frameCount < 1 || isAwaitingFirstImage(viewportId)) {
    return false;
  }

  try {
    const imageIds =
      typeof viewport.getImageIds === 'function' ? (viewport.getImageIds() ?? []) : [];
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

    // Recover onto the current frame or frame 1 only — any other cached frame is
    // usually the study browser's middle-frame thumbnail, and cine would loop from there.
    const target = currentReady ? current : isStackFrameReady(imageIds[0]) ? 0 : -1;

    if (target < 0) {
      prefetchStackFrame(imageIds[current]);
      viewport.resize?.();
      viewport.render?.();
      return false;
    }

    if (!hasPixels && typeof viewport.setStack === 'function') {
      const bindIndex = pickSafeStackBindIndex(imageIds, target, { allowAnyReadyFallback: false });
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

const UNBOUND_REPAIR_COOLDOWN_MS = 1500;
const lastUnboundRepairAt = new WeakMap<object, number>();

function getBoundStackImage(viewport) {
  try {
    return typeof viewport.getCornerstoneImage === 'function'
      ? viewport.getCornerstoneImage()
      : viewport.csImage;
  } catch {
    return null;
  }
}

/**
 * Load `imageIndex` again and display it with a fresh image actor, keeping the
 * viewport's properties. setImageIdIndex ignores the index the viewport already
 * holds, so a frame whose load failed (or whose actor went stale) is never
 * redrawn by it.
 */
function reloadStackFrame(viewport, imageIndex: number): boolean {
  if (!isViewportAlive(viewport)) {
    return false;
  }

  const imageIds: string[] =
    typeof viewport.getImageIds === 'function' ? (viewport.getImageIds() ?? []) : [];
  const imageId = imageIds[imageIndex];

  if (!imageId) {
    return false;
  }

  try {
    if (getViewportFrameIndex(viewport) !== imageIndex) {
      void Promise.resolve(viewport.setImageIdIndex(imageIndex)).catch(() => undefined);
      return true;
    }

    if (typeof viewport.calibrateSpacing === 'function') {
      viewport.calibrateSpacing(imageId);
      return true;
    }
  } catch {
    // Destroyed between the check and the call.
  }

  return false;
}

/**
 * A tile whose bound frame failed to load keeps its stack but never gets an image.
 * Sync followers, the sync-start driver and the paging recovery all skip such a
 * tile, so it stayed black while its clip finished downloading. Show a decoded
 * frame on it, `preferredIndex` first. Returns true when a frame was put up.
 */
function repairUnboundStackViewport(viewport, preferredIndex?: number | null): boolean {
  if (
    !isViewportAlive(viewport) ||
    isAwaitingFirstImage(viewport.id) ||
    typeof viewport.setImageIdIndex !== 'function' ||
    getBoundStackImage(viewport)
  ) {
    return false;
  }

  const imageIds: string[] =
    typeof viewport.getImageIds === 'function' ? (viewport.getImageIds() ?? []) : [];

  if (!imageIds.length) {
    return false;
  }

  const now = performance.now();

  if (now - (lastUnboundRepairAt.get(viewport) ?? -Infinity) < UNBOUND_REPAIR_COOLDOWN_MS) {
    return false;
  }

  const current = getViewportFrameIndex(viewport);
  const isReadyIndex = (index: number | null | undefined) =>
    index != null &&
    Number.isFinite(index) &&
    index >= 0 &&
    index < imageIds.length &&
    isStackFrameReady(imageIds[index]);

  let target = [preferredIndex, current, 0].find(isReadyIndex) ?? -1;

  if (target < 0) {
    target = imageIds.findIndex(imageId => isStackFrameReady(imageId));
  }

  if (target < 0) {
    prefetchStackFrame(imageIds[current]);
    return false;
  }

  lastUnboundRepairAt.set(viewport, now);
  return reloadStackFrame(viewport, target);
}

function viewportLacksPixels(viewport): boolean {
  if (!viewport.csImage) {
    return true;
  }
  if (viewport.useCPURendering) {
    return false;
  }
  // A failed allocation leaves no vtk image data behind csImage (later: "reading 'setOrigin'").
  return viewport._imageData == null;
}

/**
 * Repaint a stack tile that has a stack but no image (its frame failed to
 * decode, e.g. out of memory, or was dropped while the tab was hidden):
 * reload the current frame, then bind it. Resolves true when the tile was repaired.
 */
async function restoreStackViewportImage(viewport): Promise<boolean> {
  if (!isViewportAlive(viewport) || typeof viewport.setStack !== 'function') {
    return false;
  }

  const imageIds: string[] =
    typeof viewport.getImageIds === 'function' ? (viewport.getImageIds() ?? []) : [];

  if (!imageIds.length || isAwaitingFirstImage(viewport.id) || !viewportLacksPixels(viewport)) {
    return false;
  }

  const stackKey = getViewportStackKey(viewport);
  const index = Math.max(0, Math.min(imageIds.length - 1, getViewportFrameIndex(viewport)));
  const ready = await ensureStackFrameLoaded(imageIds[index]);

  // The tile may have moved to another stack (paging) while the frame loaded.
  if (!ready || !isViewportAlive(viewport) || getViewportStackKey(viewport) !== stackKey) {
    return false;
  }

  try {
    await viewport.setStack(imageIds, index);
    viewport.render?.();
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
  hasViewportPaintedFirstImage,
  isViewportAlive,
  recoverBlankStackViewport,
  recoverLayoutStackViewports,
  reloadStackFrame,
  repairUnboundStackViewport,
  restoreStackViewportImage,
  setViewportFrameIndex,
  setViewportFrameIndexAsync,
  setViewportFrameIndexById,
};
