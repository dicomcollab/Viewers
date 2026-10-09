import { cache, eventTarget, EVENTS } from '@cornerstonejs/core';
import { getAliveViewport, getViewportFrameIndex } from './safeViewportFrameUtils';
import { isStackFrameReady } from './cineFrameLoadUtils';
import { isAwaitingFirstImage } from './viewportFirstImageStore';
import { getCinePlayhead } from './cinePlayheadStore';
import { canShowClipFrame, getViewportClipDebugInfo } from './usClipBufferStore';
import {
  getSyncPlaybackMasterViewportId,
  isCinePlaybackManaged,
  isSyncPlaybackDriverActive,
} from './usCineSyncPlaybackDriver';
import { imageHasVisibleContent, isCanvasBlack } from './blankViewportGuard';
import { getRenderProbe, requestRenderProbe } from './renderLoopGuard';

/**
 * Console diagnostics for tiles that stay black.
 *
 * - `[tileDiag] Tile black …` (warn): a tile stayed black for REPORT_AFTER_MS,
 *   with a snapshot of its stack, image, playhead, clip download and canvas.
 * - `[tileDiag] Tile shows an image again` (info): the same tile recovered.
 * - `[tileDiag] Layout now shows …` (info): page / layout change.
 * - `[tileDiag] Frame loads failed …` (warn): failed frame loads, every few seconds.
 * - `ohifTileDiagnostics()` in the console prints every tile now and returns the rows.
 *
 * Off with localStorage.setItem('ohifTileDiagnostics', 'off').
 */

const WATCH_INTERVAL_MS = 1000;
const REPORT_AFTER_MS = 3000;
const FAILURE_SUMMARY_INTERVAL_MS = 5000;
const MAX_FAILURE_SAMPLES = 3;
const MB = 1024 * 1024;

type TileProblem =
  | 'viewport missing'
  | 'draws into a detached element'
  | 'shows another display set'
  | 'empty-frame cover'
  | 'no image bound'
  | 'webgl context lost'
  | 'canvas has no size'
  | 'canvas black';

let installed = false;

function isDisabled(): boolean {
  try {
    return localStorage.getItem('ohifTileDiagnostics') === 'off';
  } catch {
    return false;
  }
}

function shortUid(uid: unknown): string {
  const value = String(uid ?? '');
  return value.length > 12 ? `…${value.slice(-12)}` : value;
}

function getBoundImage(viewport) {
  try {
    return typeof viewport.getCornerstoneImage === 'function'
      ? viewport.getCornerstoneImage()
      : viewport.csImage;
  } catch {
    return null;
  }
}

function getTileDisplaySet(servicesManager: AppTypes.ServicesManager, viewportId: string) {
  const { displaySetService, viewportGridService } = servicesManager.services;
  const uid = viewportGridService.getState()?.viewports?.get(viewportId)
    ?.displaySetInstanceUIDs?.[0];
  return uid ? displaySetService.getDisplaySetByUID(uid) : null;
}

function describeDisplaySet(displaySet): string {
  if (!displaySet) {
    return '(empty)';
  }
  const instance = displaySet.instances?.[0] ?? displaySet.images?.[0];
  const instanceNumber = instance?.InstanceNumber ?? displaySet.InstanceNumber ?? '?';
  const frames = displaySet.numImageFrames ?? displaySet.imageIds?.length ?? '?';
  return `${displaySet.Modality ?? '?'} I:${instanceNumber} (${frames} fr) ${shortUid(
    instance?.SOPInstanceUID ?? displaySet.displaySetInstanceUID
  )}`;
}

function getCacheSummary() {
  let pending = 0;
  let sharedKey = 0;
  try {
    const entries = (
      cache as unknown as {
        _imageCache?: Map<string, { loaded?: boolean; sharedCacheKey?: string }>;
      }
    )._imageCache;
    entries?.forEach(entry => {
      if (!entry.loaded) {
        pending += 1;
      }
      if (entry.sharedCacheKey) {
        sharedKey += 1;
      }
    });
  } catch {
    // Diagnostics only.
  }
  return {
    usedMB: Math.round(cache.getCacheSize() / MB),
    maxMB: Math.round(cache.getMaxCacheSize() / MB),
    pendingLoads: pending,
    unevictableFrames: sharedKey,
  };
}

function snapshotTile(servicesManager: AppTypes.ServicesManager, viewportId: string) {
  const { cornerstoneViewportService, cineService } = servicesManager.services;
  const viewport = getAliveViewport(cornerstoneViewportService, viewportId);
  const displaySet = getTileDisplaySet(servicesManager, viewportId);
  const cine = cineService?.getState?.()?.cines?.[viewportId];
  const base = {
    viewportId,
    displaySet: describeDisplaySet(displaySet),
    cinePlaying: Boolean(cine?.isPlaying),
    fps: cine?.frameRate ?? null,
    syncRole: !isSyncPlaybackDriverActive()
      ? 'none'
      : getSyncPlaybackMasterViewportId() === viewportId
        ? 'master'
        : isCinePlaybackManaged(viewportId)
          ? 'driven'
          : 'not driven',
  };

  const viewportInfo = cornerstoneViewportService?.getViewportInfo?.(viewportId);
  const tileElement: HTMLElement | null = viewportInfo?.getElement?.() ?? null;
  const boundDisplaySetUID =
    viewportInfo?.getViewportData?.()?.data?.[0]?.displaySetInstanceUID ?? null;
  const tile = {
    tileInPage: Boolean(tileElement?.isConnected),
    viewportBindsTileDisplaySet: displaySet
      ? boundDisplaySetUID === displaySet.displaySetInstanceUID
      : null,
  };

  if (!viewport) {
    return { ...base, ...tile, viewport: 'missing or destroyed' };
  }

  const imageIds: string[] = viewport.getImageIds?.() ?? [];
  const currentIndex = getViewportFrameIndex(viewport);
  const image = getBoundImage(viewport);
  const playhead = getCinePlayhead(viewportId);
  const playheadImageId = playhead ? imageIds[playhead.index] : undefined;
  const canvas: HTMLCanvasElement | null = viewport.canvas ?? null;
  const clip = getViewportClipDebugInfo(viewportId, imageIds);

  return {
    ...base,
    ...tile,
    viewportDrawsIntoTile: viewport.element === tileElement,
    canvasInPage: Boolean(canvas?.isConnected),
    status: viewport.viewportStatus ?? null,
    awaitingFirstImage: isAwaitingFirstImage(viewportId),
    frames: imageIds.length,
    currentIndex,
    currentFrameDecoded: isStackFrameReady(imageIds[currentIndex]),
    imageBound: Boolean(image),
    boundImageIndex: image?.imageId ? imageIds.indexOf(image.imageId) : null,
    boundImageHasContent: image ? imageHasVisibleContent(image) : null,
    playhead: playhead ? `${playhead.index + 1}/${playhead.total}` : null,
    emptyFrameCover: playhead?.ready === false,
    playheadFrameDecoded: playheadImageId ? isStackFrameReady(playheadImageId) : null,
    playheadFrameDownloaded: playheadImageId ? canShowClipFrame(playheadImageId) : null,
    clipAttached: clip.attached,
    clipMatchesStack: clip.attachedToShownStack,
    clipBlocked: clip.blocked,
    clipStatus: clip.status,
    clipDecoded: `${clip.decoded}/${clip.total}`,
    clipDownloaded: `${clip.downloaded}/${clip.total}`,
    clipInFlight: clip.inFlight,
    clipFailed: clip.failed,
    clipViewers: clip.viewers.join(','),
    allClipsInFlight: clip.totalInFlight,
    canvas: canvas
      ? `${canvas.width}x${canvas.height} (css ${canvas.clientWidth}x${canvas.clientHeight}, render ${viewport.sWidth}x${viewport.sHeight})`
      : null,
    canvasBlack: isCanvasBlack(canvas),
    webglContextLost: Boolean(cornerstoneViewportService?.hasLostWebGlContext?.()),
    coveredBy: describeCanvasCover(canvas),
  };
}

/** The element painted over the canvas centre, when it is not the canvas (null = canvas on top). */
function describeCanvasCover(canvas: HTMLCanvasElement | null): string | null {
  if (!canvas?.clientWidth || !canvas.clientHeight) {
    return null;
  }
  const rect = canvas.getBoundingClientRect();
  const top = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
  if (!top || top === canvas) {
    return null;
  }
  const classes = Array.from(top.classList).slice(0, 3).join('.');
  const background = getComputedStyle(top).backgroundColor;
  return `${top.tagName.toLowerCase()}${classes ? `.${classes}` : ''} bg=${background}`;
}

function detectProblem(snapshot: ReturnType<typeof snapshotTile>): TileProblem | null {
  if (!('frames' in snapshot)) {
    return snapshot.displaySet !== '(empty)' && snapshot.tileInPage ? 'viewport missing' : null;
  }
  if (!snapshot.frames || snapshot.awaitingFirstImage) {
    return null;
  }
  if (!snapshot.viewportDrawsIntoTile || !snapshot.canvasInPage) {
    return 'draws into a detached element';
  }
  if (snapshot.viewportBindsTileDisplaySet === false) {
    return 'shows another display set';
  }
  if (snapshot.emptyFrameCover) {
    return 'empty-frame cover';
  }
  if (!snapshot.imageBound) {
    return 'no image bound';
  }
  if (snapshot.webglContextLost) {
    return 'webgl context lost';
  }
  if (snapshot.boundImageHasContent && snapshot.canvasBlack === null) {
    return 'canvas has no size';
  }
  if (snapshot.boundImageHasContent && snapshot.canvasBlack === true) {
    return 'canvas black';
  }
  return null;
}

/** One readable line per tile; the console table cuts off the columns that matter. */
function describeTileLine(snapshot: ReturnType<typeof snapshotTile>): string {
  const problem = detectProblem(snapshot) ?? 'ok';
  if (!('frames' in snapshot)) {
    return `${shortUid(snapshot.viewportId)} [${problem}] grid=${snapshot.displaySet} viewport=missing tileInPage=${snapshot.tileInPage} bindsTileDisplaySet=${snapshot.viewportBindsTileDisplaySet}`;
  }
  return [
    `${shortUid(snapshot.viewportId)} [${problem}] grid=${snapshot.displaySet}`,
    `bindsTileDisplaySet=${snapshot.viewportBindsTileDisplaySet}`,
    `drawsIntoTile=${snapshot.viewportDrawsIntoTile} canvasInPage=${snapshot.canvasInPage}`,
    `status=${snapshot.status} frame=${snapshot.currentIndex + 1}/${snapshot.frames} decoded=${snapshot.currentFrameDecoded}`,
    `image=${snapshot.imageBound ? `#${snapshot.boundImageIndex} content=${snapshot.boundImageHasContent}` : 'none'}`,
    `canvas=${snapshot.canvas} black=${snapshot.canvasBlack}`,
    `glLost=${snapshot.webglContextLost} coveredBy=${snapshot.coveredBy}`,
    `clip decoded=${snapshot.clipDecoded} downloaded=${snapshot.clipDownloaded} failed=${snapshot.clipFailed}`,
  ].join(' | ');
}

function getLayoutViewportIds(servicesManager: AppTypes.ServicesManager): string[] {
  const viewports = servicesManager.services.viewportGridService.getState()?.viewports;
  return viewports ? Array.from(viewports.keys()) : [];
}

function watchTiles(servicesManager: AppTypes.ServicesManager): void {
  const blackSince = new Map<string, { problem: TileProblem; at: number; reported: boolean }>();

  window.setInterval(() => {
    if (document.visibilityState === 'hidden' || isDisabled()) {
      return;
    }

    const now = Date.now();
    const viewportIds = getLayoutViewportIds(servicesManager);

    Array.from(blackSince.keys()).forEach(viewportId => {
      if (!viewportIds.includes(viewportId)) {
        blackSince.delete(viewportId);
      }
    });

    viewportIds.forEach(viewportId => {
      const snapshot = snapshotTile(servicesManager, viewportId);
      const problem = detectProblem(snapshot);
      const previous = blackSince.get(viewportId);

      if (!problem) {
        if (previous?.reported) {
          console.info(
            `[tileDiag] Tile shows an image again after ${Math.round((now - previous.at) / 1000)}s`,
            { viewportId, was: previous.problem, displaySet: snapshot.displaySet }
          );
        }
        blackSince.delete(viewportId);
        return;
      }

      if (!previous || previous.problem !== problem) {
        blackSince.set(viewportId, { problem, at: now, reported: false });
        return;
      }

      if (!previous.reported && now - previous.at >= REPORT_AFTER_MS) {
        previous.reported = true;
        console.warn(
          `[tileDiag] Tile black for ${Math.round((now - previous.at) / 1000)}s: ${describeTileLine(snapshot)}`,
          { ...snapshot, cache: getCacheSummary() }
        );
      }
    });
  }, WATCH_INTERVAL_MS);
}

function watchLayout(servicesManager: AppTypes.ServicesManager): void {
  const { viewportGridService } = servicesManager.services;
  let lastSignature = '';

  viewportGridService.subscribe(viewportGridService.EVENTS.GRID_STATE_CHANGED, () => {
    if (isDisabled()) {
      return;
    }
    const tiles: Record<string, string> = {};
    getLayoutViewportIds(servicesManager).forEach(viewportId => {
      tiles[viewportId] = describeDisplaySet(getTileDisplaySet(servicesManager, viewportId));
    });
    const signature = JSON.stringify(tiles);
    if (signature === lastSignature) {
      return;
    }
    lastSignature = signature;
    console.info('[tileDiag] Layout now shows', tiles, { cache: getCacheSummary() });
  });
}

function describeLoadError(error): string {
  if (error == null) {
    return 'rejected with no error (cancelled load)';
  }
  const inner = error?.error ?? error;
  const status = inner?.status ?? inner?.request?.status;
  if (typeof status === 'number') {
    return status === 0 ? 'aborted (HTTP 0)' : `HTTP ${status}`;
  }
  return String(inner?.message ?? inner);
}

function watchLoadFailures(): void {
  let failures = 0;
  let cacheFull = 0;
  const samples: Array<{ imageId: string; error: string }> = [];

  const record = (imageId: string | undefined, error: unknown) => {
    failures += 1;
    if (samples.length < MAX_FAILURE_SAMPLES) {
      samples.push({ imageId: shortUid(imageId), error: describeLoadError(error) });
    }
  };

  eventTarget.addEventListener(EVENTS.IMAGE_LOAD_FAILED, (evt: Event) => {
    const detail = (evt as CustomEvent).detail;
    record(detail?.imageId, detail?.error);
  });

  window.addEventListener('unhandledrejection', event => {
    const message = String(event.reason?.message ?? event.reason ?? '');
    if (message.includes('CACHE_SIZE_EXCEEDED')) {
      cacheFull += 1;
    }
  });

  window.setInterval(() => {
    if ((!failures && !cacheFull) || isDisabled()) {
      return;
    }
    console.warn(
      `[tileDiag] Frame loads failed in the last ${FAILURE_SUMMARY_INTERVAL_MS / 1000}s: ${failures}` +
        (cacheFull ? `, frames dropped because the image cache was full: ${cacheFull}` : ''),
      { samples: [...samples], cache: getCacheSummary() }
    );
    failures = 0;
    cacheFull = 0;
    samples.length = 0;
  }, FAILURE_SUMMARY_INTERVAL_MS);
}

export function installTileDiagnostics(servicesManager: AppTypes.ServicesManager): void {
  if (installed || typeof window === 'undefined') {
    return;
  }
  installed = true;

  (window as unknown as { ohifTileDiagnostics: () => unknown }).ohifTileDiagnostics = () => {
    const rows = getLayoutViewportIds(servicesManager).map(viewportId =>
      snapshotTile(servicesManager, viewportId)
    );
    const viewportIds = getLayoutViewportIds(servicesManager);
    viewportIds.forEach(viewportId => {
      requestRenderProbe(viewportId);
      getAliveViewport(servicesManager.services.cornerstoneViewportService, viewportId)?.render?.();
    });
    window.setTimeout(() => {
      console.log(
        [
          '[tileDiag] render probe (gl = WebGL drew the image, 2dLost = tile canvas lost, tile = image reached the tile):',
          ...viewportIds.map(viewportId => {
            const probe = getRenderProbe(viewportId);
            return `${shortUid(viewportId)} ${
              probe && Date.now() - probe.at < 2000
                ? `gl=${probe.glDrewContent} 2dLost=${probe.onscreenContextLost} tile=${probe.onscreenHasContent}`
                : 'no render happened'
            }`;
          }),
        ].join('\n')
      );
    }, 500);

    const cacheSummary = getCacheSummary();
    console.log(
      [
        `[tileDiag] visibility=${document.visibilityState} cache=${cacheSummary.usedMB}/${cacheSummary.maxMB} MB pending=${cacheSummary.pendingLoads}`,
        ...rows.map(describeTileLine),
      ].join('\n')
    );
    return rows;
  };

  watchTiles(servicesManager);
  watchLayout(servicesManager);
  watchLoadFailures();
}
