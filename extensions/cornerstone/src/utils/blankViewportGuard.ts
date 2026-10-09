/**
 * Keeps stack tiles from sitting black.
 *
 * IMAGE_RENDERED and viewportStatus only say a render ran, not that pixels
 * reached the canvas. The context-pool rendering engine skips drawing (while
 * still marking the viewport RENDERED) when the viewport's stored size is
 * stale or below 2px; a cancelled first load or a stale actor also leave a
 * black canvas under a correct overlay (W/L, frame count).
 *
 * Every tick this checks the stored render size against the canvas on screen,
 * then samples the visible canvas. Two cases are repaired:
 * - no image bound after the bind finished (its first frame failed to load):
 *   a decoded frame of the stack is put up;
 * - an image with content is bound but the canvas stays black, also while the
 *   clip plays: render → resize → reload the frame with a fresh actor → rebind.
 */
import { Enums, cache } from '@cornerstonejs/core';
import {
  getAliveViewport,
  getViewportFrameIndex,
  getViewportStackKey,
  reloadStackFrame,
  repairUnboundStackViewport,
} from './safeViewportFrameUtils';
import { isStackFrameReady } from './cineFrameLoadUtils';
import { endFirstImageWait, isAwaitingFirstImage } from './viewportFirstImageStore';
import { getCinePlayhead } from './cinePlayheadStore';
import {
  getRenderProbe,
  rebuildViewportWebGlContext,
  requestRenderProbe,
} from './renderLoopGuard';
import { relieveMemoryPressure } from './memoryPressure';

const CHECK_INTERVAL_MS = 700;
const REVERIFY_EVERY_TICKS = 8;
const SAMPLE_SIZE = 64;
/** Max channel value still considered black on the downscaled canvas sample. */
const CANVAS_BLACK_MAX = 6;
/** Raw pixel range below which the image itself is blank, so black is correct. */
const IMAGE_CONTENT_MIN_RANGE = 16;
/** A bind waits up to 20s for its first frame; past that the wait is stale. */
const STALE_FIRST_IMAGE_WAIT_MS = 25000;
/** Allowed mismatch between the stored render size and the on-screen canvas. */
const SIZE_TOLERANCE_PX = 2;
const SIZE_FIX_COOLDOWN_MS = 3000;
/** Consecutive ticks a state must last before it is treated as broken. */
const NO_IMAGE_TICKS_BEFORE_REPAIR = 2;
const BLACK_TICKS_BEFORE_REPAIR = 2;
/** Repair steps per black episode, by ticks since repairs started. */
const RENDER_STEP = 0;
const RESIZE_STEP = 1;
const RELOAD_STEP = 2;
const REBIND_STEP = 5;
const MAX_REBINDS_PER_STACK = 2;
const NULL_CANVAS_RESIZE_EVERY_TICKS = 4;
const MAX_MID_RENDER_TICKS = 4;
/** Shared by all tiles: one engine rebuild repaints every tile. */
const CONTEXT_RECOVERY_COOLDOWN_MS = 10000;
const PROBE_MAX_AGE_MS = 3000;
const CANVAS_RESET_COOLDOWN_MS = 5000;
/** Cache this full when a tile stays black: free memory before rebuilding its context. */
const FULL_CACHE_FRACTION = 0.9;
const ALLOC_PROBE_BYTES = 64 * 1024 * 1024;

const contentByImage = new WeakMap<object, boolean>();
let sampleCanvas: HTMLCanvasElement | null = null;
let lastContextRecoveryAt = 0;

function getBoundImage(viewport) {
  try {
    return typeof viewport.getCornerstoneImage === 'function'
      ? viewport.getCornerstoneImage()
      : viewport.csImage;
  } catch {
    return null;
  }
}

function getViewportCanvas(viewport): HTMLCanvasElement | null {
  return viewport.canvas ?? viewport.getCanvas?.() ?? null;
}

function imageHasVisibleContent(image): boolean {
  const cached = contentByImage.get(image);

  if (cached != null) {
    return cached;
  }

  let result = false;

  try {
    const data = image.getPixelData?.();

    if (data?.length) {
      const stride = Math.max(1, Math.floor(data.length / 8192));
      let min = Infinity;
      let max = -Infinity;

      for (let i = 0; i < data.length; i += stride) {
        const value = data[i];
        if (value < min) {
          min = value;
        }
        if (value > max) {
          max = value;
        }
      }

      result = max - min > IMAGE_CONTENT_MIN_RANGE;
    }
  } catch {
    result = false;
  }

  contentByImage.set(image, result);
  return result;
}

/**
 * True when the size the engine renders at no longer matches the canvas on
 * screen — renders are then skipped or copied from the wrong region (black).
 */
function hasStaleRenderSize(viewport, canvas: HTMLCanvasElement | null): boolean {
  if (!canvas || !canvas.clientWidth || !canvas.clientHeight) {
    return false;
  }

  const dpr = window.devicePixelRatio || 1;
  const expectedWidth = canvas.clientWidth * dpr;
  const expectedHeight = canvas.clientHeight * dpr;
  const sWidth = Number(viewport.sWidth);
  const sHeight = Number(viewport.sHeight);

  return (
    Math.abs(canvas.width - expectedWidth) > SIZE_TOLERANCE_PX * dpr ||
    Math.abs(canvas.height - expectedHeight) > SIZE_TOLERANCE_PX * dpr ||
    (Number.isFinite(sWidth) && sWidth < 2) ||
    (Number.isFinite(sHeight) && sHeight < 2) ||
    (Number.isFinite(sWidth) && Math.abs(sWidth - canvas.width) > SIZE_TOLERANCE_PX) ||
    (Number.isFinite(sHeight) && Math.abs(sHeight - canvas.height) > SIZE_TOLERANCE_PX)
  );
}

/** true = black, false = painted, null = canvas has no size / unreadable. */
function isCanvasBlack(canvas: HTMLCanvasElement | null | undefined): boolean | null {
  if (!canvas || !canvas.width || !canvas.height) {
    return null;
  }

  try {
    sampleCanvas ??= document.createElement('canvas');
    sampleCanvas.width = SAMPLE_SIZE;
    sampleCanvas.height = SAMPLE_SIZE;

    const ctx = sampleCanvas.getContext('2d', { willReadFrequently: true });

    if (!ctx) {
      return null;
    }

    ctx.clearRect(0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
    ctx.drawImage(canvas, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);

    const { data } = ctx.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE);

    for (let i = 0; i < data.length; i += 4) {
      if (
        data[i] > CANVAS_BLACK_MAX ||
        data[i + 1] > CANVAS_BLACK_MAX ||
        data[i + 2] > CANVAS_BLACK_MAX
      ) {
        return false;
      }
    }

    return true;
  } catch {
    return null;
  }
}

function resizeViewport(viewport): void {
  try {
    viewport.getRenderingEngine?.()?.resize?.(true, true);
  } catch {
    // Rendering engine may be mid-teardown after a layout swap.
  }
}

function rebindStack(viewport): void {
  const imageIds: string[] =
    typeof viewport.getImageIds === 'function' ? (viewport.getImageIds() ?? []) : [];

  if (!imageIds.length || typeof viewport.setStack !== 'function') {
    return;
  }

  const current = getViewportFrameIndex(viewport);
  const target = isStackFrameReady(imageIds[current])
    ? current
    : imageIds.findIndex(imageId => isStackFrameReady(imageId));

  if (target < 0) {
    return;
  }

  resizeViewport(viewport);
  void Promise.resolve(viewport.setStack(imageIds, target))
    .then(() => viewport.render?.())
    .catch(() => undefined);
}

function describeViewport(viewport, image, canvas: HTMLCanvasElement | null) {
  const imageIds: string[] =
    typeof viewport.getImageIds === 'function' ? (viewport.getImageIds() ?? []) : [];
  const playhead = getCinePlayhead(viewport.id);

  return {
    viewportId: viewport.id,
    status: viewport.viewportStatus,
    frames: imageIds.length,
    currentIndex: getViewportFrameIndex(viewport),
    imageIndex: image?.imageId ? imageIds.indexOf(image.imageId) : null,
    playhead: playhead ? `${playhead.index + 1}/${playhead.total} ready=${playhead.ready}` : null,
    sWidth: viewport.sWidth,
    sHeight: viewport.sHeight,
    canvasWidth: canvas?.width,
    canvasHeight: canvas?.height,
    clientWidth: canvas?.clientWidth,
    clientHeight: canvas?.clientHeight,
    imageId: image?.imageId,
    imageWidth: image?.width ?? image?.columns,
    imageHeight: image?.height ?? image?.rows,
    color: image?.color,
  };
}

/** The pixels vtk uploads as the texture (a copy of the image made when it was bound). */
function describeVtkImage(viewport): string {
  try {
    const imageData = viewport.getImageData?.()?.imageData;
    const values = imageData?.getPointData?.()?.getScalars?.()?.getData?.();
    if (!values?.length) {
      return 'no pixel data';
    }
    const stride = Math.max(1, Math.floor(values.length / 4096));
    let hasContent = false;
    for (let i = 0; i < values.length; i += stride) {
      if (values[i] > CANVAS_BLACK_MAX) {
        hasContent = true;
        break;
      }
    }
    const actor = viewport.getDefaultActor?.()?.actor;
    return `${imageData.getDimensions?.()?.join('x')} ${hasContent ? 'content' : 'empty'} actors=${
      viewport.getActors?.()?.length ?? 0
    } visible=${actor?.getVisibility?.() ?? null}`;
  } catch (error) {
    return `unreadable (${(error as Error)?.message ?? error})`;
  }
}

function canAllocate(bytes: number): boolean {
  try {
    return new Uint8Array(bytes).length === bytes;
  } catch {
    return false;
  }
}

function isCacheNearlyFull(): boolean {
  const max = cache.getMaxCacheSize();
  return max > 0 && cache.getCacheSize() >= max * FULL_CACHE_FRACTION;
}

function isMidRender(viewport): boolean {
  const status = viewport.viewportStatus;
  const rendered = Enums.ViewportStatus?.RENDERED;
  return status != null && rendered != null && status !== rendered;
}

/**
 * Watch one viewport for "no image after the bind" and "image bound, canvas
 * black" and repair it. Returns a stop function.
 */
export function startBlankViewportGuard(
  cornerstoneViewportService,
  viewportId: string
): () => void {
  let verifiedImage: object | null = null;
  let ticksSinceVerify = 0;
  let awaitingSince: number | null = null;
  let waitIsStale = false;
  let lastSizeFixAt = 0;
  let noImageTicks = 0;
  let blackTicks = 0;
  let nullCanvasTicks = 0;
  let midRenderTicks = 0;
  let reportedBlackEpisode = false;
  let reportedFailedRepair = false;
  let rebuiltContextForStack = false;
  let episodeStartedAt = 0;
  let lastCanvasResetAt = 0;
  const episodeWebGlErrors = new Set<string>();
  let repairStackKey: string | null = null;
  let rebindsForStack = 0;
  const reportedUnboundStacks = new Set<string>();

  const intervalId = window.setInterval(() => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      return;
    }

    const viewport = getAliveViewport(cornerstoneViewportService, viewportId);

    if (
      !viewport ||
      typeof viewport.getImageIds !== 'function' ||
      typeof viewport.setStack !== 'function'
    ) {
      return;
    }

    const image = getBoundImage(viewport);
    const canvas = getViewportCanvas(viewport);
    const now = Date.now();
    const stackKey = getViewportStackKey(viewport);

    if (stackKey !== repairStackKey) {
      repairStackKey = stackKey;
      rebindsForStack = 0;
      reportedFailedRepair = false;
      rebuiltContextForStack = false;
    }

    if (
      image &&
      hasStaleRenderSize(viewport, canvas) &&
      now - lastSizeFixAt > SIZE_FIX_COOLDOWN_MS
    ) {
      lastSizeFixAt = now;
      resizeViewport(viewport);
      return;
    }

    if (isAwaitingFirstImage(viewportId)) {
      awaitingSince ??= now;

      if (now - awaitingSince < STALE_FIRST_IMAGE_WAIT_MS) {
        noImageTicks = 0;
        blackTicks = 0;
        return;
      }

      waitIsStale = true;
    } else {
      awaitingSince = null;
      waitIsStale = false;
    }

    if (!image) {
      blackTicks = 0;
      noImageTicks += 1;

      if (noImageTicks < NO_IMAGE_TICKS_BEFORE_REPAIR) {
        return;
      }

      // The bind hung on its first frame; the frames that did arrive can be shown.
      if (waitIsStale) {
        endFirstImageWait(viewportId);
        waitIsStale = false;
        awaitingSince = null;
      }

      if (repairUnboundStackViewport(viewport, getCinePlayhead(viewportId)?.index)) {
        const key = stackKey ?? '';
        if (!reportedUnboundStacks.has(key)) {
          reportedUnboundStacks.add(key);
          console.warn(
            '[blankViewportGuard] Tile had no image after its bind (first frame failed); showing a decoded frame.',
            describeViewport(viewport, null, canvas)
          );
        }
      }
      return;
    }

    noImageTicks = 0;

    // The empty-frame cover is up while the playhead is on a frame still downloading.
    if (getCinePlayhead(viewportId)?.ready === false) {
      blackTicks = 0;
      return;
    }

    // A swap or bind is between load and render; judge a later tick. A swap whose
    // load failed leaves the status there for good, so that is judged eventually.
    if (isMidRender(viewport)) {
      if (++midRenderTicks < MAX_MID_RENDER_TICKS) {
        return;
      }
    } else {
      midRenderTicks = 0;
    }

    if (image === verifiedImage && ++ticksSinceVerify < REVERIFY_EVERY_TICKS) {
      return;
    }

    if (!imageHasVisibleContent(image)) {
      blackTicks = 0;
      return;
    }

    const black = isCanvasBlack(canvas);

    if (black === null) {
      if (nullCanvasTicks++ % NULL_CANVAS_RESIZE_EVERY_TICKS === 0) {
        resizeViewport(viewport);
        viewport.render?.();
      }
      return;
    }

    nullCanvasTicks = 0;

    if (black === false) {
      if (reportedBlackEpisode) {
        console.info(
          `[blankViewportGuard] Tile painted again after ${Math.round((now - episodeStartedAt) / 1000)}s (rebinds: ${rebindsForStack}).`,
          { viewportId }
        );
      }
      verifiedImage = image;
      ticksSinceVerify = 0;
      blackTicks = 0;
      reportedBlackEpisode = false;
      reportedFailedRepair = false;
      episodeWebGlErrors.clear();

      if (waitIsStale) {
        endFirstImageWait(viewportId);
        waitIsStale = false;
        awaitingSince = null;
      }
      return;
    }

    verifiedImage = null;
    blackTicks += 1;

    if (blackTicks < BLACK_TICKS_BEFORE_REPAIR) {
      return;
    }

    const contextLost = Boolean(cornerstoneViewportService.hasLostWebGlContext?.());
    const webglErrors: string[] = cornerstoneViewportService.readWebGlErrors?.() ?? [];
    webglErrors.forEach(error => episodeWebGlErrors.add(error));

    if (!reportedBlackEpisode) {
      reportedBlackEpisode = true;
      episodeStartedAt = now;
      console.warn(
        `[blankViewportGuard] Image is bound but the tile is black; repairing. webglContextLost=${contextLost} webglErrors=${webglErrors.join(',') || 'none'}`,
        {
          ...describeViewport(viewport, image, canvas),
          webglContextLost: contextLost,
          renderTarget: cornerstoneViewportService.describeRenderTarget?.(viewportId),
        }
      );
    }

    // A lost WebGL context renders every tile black; only a new rendering engine paints again.
    if (contextLost) {
      if (now - lastContextRecoveryAt > CONTEXT_RECOVERY_COOLDOWN_MS) {
        lastContextRecoveryAt = now;
        void cornerstoneViewportService.recoverRenderingAfterWebGlContextLoss?.();
      }
      blackTicks = BLACK_TICKS_BEFORE_REPAIR - 1;
      return;
    }

    const probe = getRenderProbe(viewportId);
    const probeIsFresh = probe && now - probe.at < PROBE_MAX_AGE_MS;
    requestRenderProbe(viewportId);
    viewport.render?.();

    // WebGL drew the image but the copy did not reach the tile: its 2D canvas lost its
    // backing (GPU memory pressure). Nothing re-renders onto it; reallocate it.
    if (
      probeIsFresh &&
      probe.glDrewContent === true &&
      (probe.onscreenContextLost === true || probe.onscreenHasContent === false) &&
      canvas
    ) {
      if (now - lastCanvasResetAt > CANVAS_RESET_COOLDOWN_MS) {
        lastCanvasResetAt = now;
        console.warn(
          `[blankViewportGuard] The tile canvas drops what WebGL drew (2D context lost=${probe.onscreenContextLost}); reallocating it.`,
          { viewportId }
        );
        const { width, height } = canvas;
        canvas.width = 0;
        canvas.height = 0;
        canvas.width = width;
        canvas.height = height;
      }
      viewport.render?.();
      return;
    }

    const step = blackTicks - BLACK_TICKS_BEFORE_REPAIR;

    if (step === RENDER_STEP) {
      viewport.render?.();
    } else if (step === RESIZE_STEP) {
      resizeViewport(viewport);
      viewport.render?.();
    } else if (step === RELOAD_STEP) {
      reloadStackFrame(viewport, getViewportFrameIndex(viewport));
    } else if (step === REBIND_STEP) {
      if (
        rebindsForStack < MAX_REBINDS_PER_STACK &&
        (rebindsForStack === 0 || rebuiltContextForStack)
      ) {
        rebindsForStack += 1;
        rebindStack(viewport);
        // Start the escalation over; a second rebind waits for another full cycle.
        blackTicks = BLACK_TICKS_BEFORE_REPAIR - 1;
      } else if (!rebuiltContextForStack) {
        // The image and its vtk copy are fine but the shared WebGL context draws black
        // (it degrades after many pages under a full cache). Give the tiles on it a new one.
        rebuiltContextForStack = true;
        const cacheBefore = Math.round(cache.getCacheSize() / (1024 * 1024));
        const freedMemory = isCacheNearlyFull() && relieveMemoryPressure('tile stays black');
        const rebuilt = rebuildViewportWebGlContext(viewport.getRenderingEngine?.(), viewportId);
        console.warn(
          `[blankViewportGuard] Tile still black after a rebind; ${
            rebuilt
              ? `rebuilt WebGL context ${rebuilt.contextIndex} (${rebuilt.viewportIds.length} tiles)`
              : 'its WebGL context was rebuilt moments ago'
          }${freedMemory ? `, freed image cache (was ${cacheBefore} MB)` : ''}. vtkImage=${describeVtkImage(viewport)}`,
          { viewportId }
        );
        blackTicks = BLACK_TICKS_BEFORE_REPAIR - 1;
      } else if (!reportedFailedRepair) {
        reportedFailedRepair = true;
        console.error(
          `[blankViewportGuard] Repairs did not paint the tile (render, resize, reload, ${MAX_REBINDS_PER_STACK} rebinds, new WebGL context over ${Math.round(
            (now - episodeStartedAt) / 1000
          )}s). webglErrors=${Array.from(episodeWebGlErrors).join(',') || 'none'} renderTarget=${JSON.stringify(
            cornerstoneViewportService.describeRenderTarget?.(viewportId)
          )} renderProbe=${JSON.stringify(probeIsFresh ? probe : null)} vtkImage=${describeVtkImage(
            viewport
          )} cache=${Math.round(cache.getCacheSize() / (1024 * 1024))}MB alloc64MB=${canAllocate(ALLOC_PROBE_BYTES)}`,
          describeViewport(viewport, image, canvas)
        );
      }
    }
    // With a live context, never escalate to destroying the shared rendering engine:
    // one black tile must not tear down every tile (and a failed teardown leaves all of them dead).
  }, CHECK_INTERVAL_MS);

  return () => window.clearInterval(intervalId);
}

export { imageHasVisibleContent, isCanvasBlack };
