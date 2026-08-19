import { getEnabledElement, Enums, eventTarget, EVENTS } from '@cornerstonejs/core';
import { utilities } from '@cornerstonejs/tools';
import { getSyncedViewports } from './utils/cineSyncUtils';
import { validateSyncPlaybackDriver } from './utils/usCineSyncPlaybackDriver';
import { ensureLayoutCinePlayback } from './utils/usCinePlaybackUtils';
import { getAliveViewport, isViewportAlive } from './utils/safeViewportFrameUtils';
import { cineDebug, cineDebugError, cineDebugWarn } from './utils/cineDebug';
import {
  clearCustomClip,
  clearCustomClipByViewportId,
  setCustomClip,
} from './utils/cineClipStateUtils';
import {
  isStackFrameReady,
  prefetchStackFrame,
  prefetchUpcomingStackFrames,
} from './utils/cineFrameLoadUtils';
import { setCineWaitingForFrame } from './utils/cineFrameWaitStore';

export const DEFAULT_FRAME_STEP = 4;
export const STEP_INTERVAL_MS = 400;
const LIVE_CLIP_TICK_MS = 16;
const liveClipCleanups = new Map<string, () => void>();

function cleanupLiveClip(viewportId?: string): void {
  if (!viewportId) {
    return;
  }

  liveClipCleanups.get(viewportId)?.();
  liveClipCleanups.delete(viewportId);
  setCineWaitingForFrame(viewportId, null);
}

function getLiveStackViewport(
  servicesManager: AppTypes.ServicesManager,
  element: HTMLElement,
  viewportId?: string
) {
  if (viewportId) {
    const byId = getAliveViewport(
      servicesManager.services.cornerstoneViewportService,
      viewportId
    );

    if (byId) {
      return byId;
    }
  }

  const enabledElement = getEnabledElement(element);
  const viewport = enabledElement?.viewport;

  return isViewportAlive(viewport) ? viewport : null;
}

function getLiveClipPeriodMs(
  servicesManager: AppTypes.ServicesManager,
  viewportId: string | undefined,
  cinePlayMode: 'fps' | 'step' | undefined,
  fallbackFps: number
): number {
  if (cinePlayMode === 'step') {
    return STEP_INTERVAL_MS;
  }

  const fpsFromState = viewportId
    ? Number(servicesManager.services.cineService.getState().cines?.[viewportId]?.frameRate)
    : NaN;
  const fps = Math.max(
    1,
    Number.isFinite(fpsFromState) && fpsFromState > 0 ? fpsFromState : fallbackFps
  );

  return 1000 / fps;
}

/**
 * One 16ms ticker per viewport. Frame period is read live from cineService so
 * FPS changes apply immediately after a layout reuse — no pause/play needed.
 */
function startLiveStackClip(
  servicesManager: AppTypes.ServicesManager,
  element: HTMLElement,
  options: {
    viewportId?: string;
    framesPerSecond?: number;
    cinePlayMode?: 'fps' | 'step';
    frameStep?: number;
  }
) {
  const viewportId = options.viewportId;
  const fallbackFps = Math.max(1, Number(options.framesPerSecond) || 1);
  const frameStep = Math.max(
    1,
    Math.round(options.cinePlayMode === 'step' ? (options.frameStep ?? DEFAULT_FRAME_STEP) : 1)
  );

  clearCustomClipByViewportId(viewportId);
  clearCustomClip(element);
  setCineWaitingForFrame(viewportId, null);

  let nextFrameAt = performance.now();
  let lastPeriodMs = getLiveClipPeriodMs(
    servicesManager,
    viewportId,
    options.cinePlayMode,
    fallbackFps
  );
  let hasPaintedOnce = false;
  let waitingImageId: string | null = null;

  const onImageLoaded = (evt: Event) => {
    const loadedId = (evt as CustomEvent)?.detail?.image?.imageId ?? (evt as CustomEvent)?.detail?.imageId;

    if (!loadedId || loadedId !== waitingImageId) {
      return;
    }

    nextFrameAt = Math.min(nextFrameAt, performance.now());
  };

  eventTarget.addEventListener(EVENTS.IMAGE_LOADED, onImageLoaded);
  cleanupLiveClip(viewportId);
  if (viewportId) {
    liveClipCleanups.set(viewportId, () => {
      eventTarget.removeEventListener(EVENTS.IMAGE_LOADED, onImageLoaded);
      setCineWaitingForFrame(viewportId, null);
    });
  }

  const intervalId = window.setInterval(() => {
    const liveViewport = getLiveStackViewport(servicesManager, element, viewportId);

    if (!liveViewport) {
      eventTarget.removeEventListener(EVENTS.IMAGE_LOADED, onImageLoaded);
      setCineWaitingForFrame(viewportId, null);
      clearCustomClipByViewportId(viewportId);
      clearCustomClip(element);
      return;
    }

    const periodMs = getLiveClipPeriodMs(
      servicesManager,
      viewportId,
      options.cinePlayMode,
      fallbackFps
    );

    if (periodMs !== lastPeriodMs) {
      nextFrameAt = Math.min(nextFrameAt, performance.now());
      lastPeriodMs = periodMs;
    }

    const now = performance.now();
    const imageIds =
      typeof liveViewport.getImageIds === 'function' ? liveViewport.getImageIds() ?? [] : [];
    const liveCount = imageIds.length;

    if (liveCount <= 1) {
      nextFrameAt = now + periodMs;
      prefetchUpcomingStackFrames(imageIds, 0);
      return;
    }

    const viewportStatus = liveViewport.viewportStatus;
    if (
      !hasPaintedOnce &&
      viewportStatus != null &&
      Enums.ViewportStatus?.RENDERED != null &&
      viewportStatus !== Enums.ViewportStatus.RENDERED
    ) {
      nextFrameAt = now + periodMs;
      return;
    }

    if (viewportStatus === Enums.ViewportStatus.RENDERED) {
      hasPaintedOnce = true;
    }

    let index = 0;

    try {
      index =
        typeof liveViewport.getCurrentImageIdIndex === 'function'
          ? liveViewport.getCurrentImageIdIndex()
          : 0;
    } catch {
      eventTarget.removeEventListener(EVENTS.IMAGE_LOADED, onImageLoaded);
      setCineWaitingForFrame(viewportId, null);
      clearCustomClipByViewportId(viewportId);
      clearCustomClip(element);
      return;
    }

    prefetchUpcomingStackFrames(imageIds, index);

    if (now < nextFrameAt) {
      return;
    }

    const nextIndex = (index + frameStep) % liveCount;
    const nextImageId = imageIds[nextIndex];

    if (!isStackFrameReady(nextImageId)) {
      waitingImageId = nextImageId;
      prefetchStackFrame(nextImageId);
      setCineWaitingForFrame(viewportId, {
        imageIndex: nextIndex,
        imageId: nextImageId,
      });
      // Stay on the current frame until the next one is in cache.
      nextFrameAt = now + Math.min(periodMs, 50);
      return;
    }

    waitingImageId = null;
    setCineWaitingForFrame(viewportId, null);

    if (nextIndex !== index) {
      try {
        liveViewport.setImageIdIndex(nextIndex);
        hasPaintedOnce = true;
      } catch {
        eventTarget.removeEventListener(EVENTS.IMAGE_LOADED, onImageLoaded);
        setCineWaitingForFrame(viewportId, null);
        clearCustomClipByViewportId(viewportId);
        clearCustomClip(element);
        return;
      }
    }

    nextFrameAt = now + periodMs;
  }, LIVE_CLIP_TICK_MS);

  setCustomClip(element, intervalId, viewportId);
}

function isStackCineViewport(viewport): boolean {
  return (
    Boolean(viewport) &&
    typeof viewport.getImageIds === 'function' &&
    typeof viewport.setImageIdIndex === 'function'
  );
}

function initCineService(servicesManager: AppTypes.ServicesManager) {
  const { cineService } = servicesManager.services;

  const getSyncedViewportsForViewport = viewportId => {
    const synced = getSyncedViewports(servicesManager, viewportId);
    cineDebug('initCineService', 'getSyncedViewports', { viewportId, synced });
    return synced;
  };

  const playClip = (element, playClipOptions = {}) => {
    const { viewportId, framesPerSecond, cinePlayMode, frameStep } = playClipOptions as {
      viewportId?: string;
      framesPerSecond?: number;
      cinePlayMode?: 'fps' | 'step';
      frameStep?: number;
    };

    try {
      const liveViewport = getLiveStackViewport(servicesManager, element, viewportId);
      const playElement = liveViewport?.element ?? element;
      const enabledElement = getEnabledElement(playElement);

      if (!enabledElement && !liveViewport) {
        cineDebugWarn(
          'initCineService',
          'playClip skipped — element is not a Cornerstone enabled element',
          {
            viewportId,
            framesPerSecond,
          }
        );
        return;
      }

      const viewport = liveViewport ?? enabledElement?.viewport;

      cineDebug('initCineService', 'playClip', {
        viewportId,
        framesPerSecond,
        cinePlayMode,
        frameStep,
        cornerstoneViewportId: viewport?.id,
        viewportType: viewport?.type,
      });

      utilities.cine.stopClip(playElement, { viewportId });
      cleanupLiveClip(viewportId);
      clearCustomClipByViewportId(viewportId);
      clearCustomClip(playElement);
      clearCustomClip(element);

      if (isStackCineViewport(viewport)) {
        startLiveStackClip(servicesManager, playElement, {
          viewportId,
          framesPerSecond,
          cinePlayMode,
          frameStep,
        });
        return;
      }

      return utilities.cine.playClip(playElement, playClipOptions);
    } catch (error) {
      cineDebugError('initCineService', 'playClip failed', error);
    }
  };

  const stopClip = (element, stopClipOptions = {}) => {
    const { viewportId } = stopClipOptions as { viewportId?: string };

    cineDebug('initCineService', 'stopClip', { viewportId });

    try {
      const liveViewport = getLiveStackViewport(servicesManager, element, viewportId);
      const stopElement = liveViewport?.element ?? element;

      cleanupLiveClip(viewportId);
      clearCustomClipByViewportId(viewportId);
      clearCustomClip(stopElement);
      clearCustomClip(element);
      return utilities.cine.stopClip(stopElement, stopClipOptions);
    } catch (error) {
      cineDebugError('initCineService', 'stopClip failed', error);
    }
  };

  cineService.setServiceImplementation({
    getSyncedViewports: getSyncedViewportsForViewport,
    playClip,
    stopClip,
  });

  const { viewportGridService } = servicesManager.services;
  let ensureTimer: ReturnType<typeof setTimeout> | null = null;
  let ensureAttempts = 0;

  viewportGridService.subscribe(viewportGridService.EVENTS.GRID_STATE_CHANGED, () => {
    validateSyncPlaybackDriver(servicesManager);

    if (ensureTimer) {
      window.clearTimeout(ensureTimer);
    }

    ensureAttempts = 0;
    const run = () => {
      const settled = ensureLayoutCinePlayback(servicesManager);
      ensureAttempts += 1;

      if (!settled && ensureAttempts < 16) {
        ensureTimer = window.setTimeout(run, 200);
      }
    };

    ensureTimer = window.setTimeout(run, 80);
  });

  cineDebug('initCineService', 'Cine service implementation registered');
}

export default initCineService;
