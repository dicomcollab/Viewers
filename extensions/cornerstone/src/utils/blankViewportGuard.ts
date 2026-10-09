/**
 * Keeps stack tiles from sitting black when an image is bound.
 *
 * IMAGE_RENDERED and viewportStatus only say a render ran, not that pixels
 * reached the canvas. The context-pool rendering engine skips drawing (while
 * still marking the viewport RENDERED) when the viewport's stored size is
 * stale or below 2px; a cancelled first load or a stale actor also leave a
 * black canvas under a correct overlay (W/L, frame count).
 *
 * Every tick this checks the stored render size against the canvas on screen,
 * then samples the visible canvas. While the bound image has content but the
 * canvas is black it escalates: render → resize → rebind the stack.
 */
import { getAliveViewport, getViewportFrameIndex } from './safeViewportFrameUtils';
import { isStackFrameReady } from './cineFrameLoadUtils';
import { endFirstImageWait, isAwaitingFirstImage } from './viewportFirstImageStore';

const CHECK_INTERVAL_MS = 700;
const REVERIFY_EVERY_TICKS = 8;
const SAMPLE_SIZE = 64;
/** Max channel value still considered black on the downscaled canvas sample. */
const CANVAS_BLACK_MAX = 6;
/** Raw pixel range below which the image itself is blank, so black is correct. */
const IMAGE_CONTENT_MIN_RANGE = 16;
const MAX_ATTEMPTS_PER_IMAGE = 6;
const MAX_REBINDS_PER_IMAGE = 2;
/** A bind waits up to 20s for its first frame; past that the wait is stale. */
const STALE_FIRST_IMAGE_WAIT_MS = 25000;
/** Allowed mismatch between the stored render size and the on-screen canvas. */
const SIZE_TOLERANCE_PX = 2;
const SIZE_FIX_COOLDOWN_MS = 3000;

const contentByImage = new WeakMap<object, boolean>();
let sampleCanvas: HTMLCanvasElement | null = null;

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
  return {
    viewportId: viewport.id,
    status: viewport.viewportStatus,
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

/**
 * Watch one viewport for "image bound, canvas black" and repair it.
 * Returns a stop function.
 */
export function startBlankViewportGuard(
  cornerstoneViewportService,
  viewportId: string
): () => void {
  let lastImage: object | null = null;
  let verifiedImage: object | null = null;
  let ticksSinceVerify = 0;
  let attempts = 0;
  let awaitingSince: number | null = null;
  let waitIsStale = false;
  let lastSizeFixAt = 0;
  const rebindsByImageId = new Map<string, number>();
  const reportedImageIds = new Set<string>();

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
        return;
      }

      waitIsStale = true;
    } else {
      awaitingSince = null;
      waitIsStale = false;
    }

    if (!image) {
      return;
    }

    // Only judge an image that stayed put for a full tick, so a cine swap or a
    // bind in flight is never mistaken for a black tile.
    if (image !== lastImage) {
      lastImage = image;
      attempts = 0;
      return;
    }

    if (image === verifiedImage && ++ticksSinceVerify < REVERIFY_EVERY_TICKS) {
      return;
    }

    if (!imageHasVisibleContent(image)) {
      return;
    }

    const black = isCanvasBlack(canvas);

    if (black === false) {
      verifiedImage = image;
      ticksSinceVerify = 0;
      attempts = 0;

      if (waitIsStale) {
        endFirstImageWait(viewportId);
        waitIsStale = false;
        awaitingSince = null;
      }
      return;
    }

    verifiedImage = null;

    if (attempts >= MAX_ATTEMPTS_PER_IMAGE) {
      return;
    }

    attempts += 1;

    const imageId = (image as { imageId?: string }).imageId ?? '';

    if (!reportedImageIds.has(imageId)) {
      reportedImageIds.add(imageId);
      console.warn(
        '[blankViewportGuard] Image is bound but the tile is black; repairing.',
        describeViewport(viewport, image, canvas)
      );
    }

    if (black === null || attempts <= 2) {
      if (black === null || attempts === 2) {
        resizeViewport(viewport);
      }
      viewport.render?.();
      return;
    }

    const rebinds = rebindsByImageId.get(imageId) ?? 0;

    if (rebinds < MAX_REBINDS_PER_IMAGE) {
      rebindsByImageId.set(imageId, rebinds + 1);
      rebindStack(viewport);
    }
    // Never escalate to destroying the shared rendering engine: one black tile
    // must not tear down every tile (and a failed teardown leaves all of them dead).
  }, CHECK_INTERVAL_MS);

  return () => window.clearInterval(intervalId);
}
