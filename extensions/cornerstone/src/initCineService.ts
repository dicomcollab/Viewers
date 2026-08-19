import { getEnabledElement, Enums } from '@cornerstonejs/core';
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

export const DEFAULT_FRAME_STEP = 4;
export const STEP_INTERVAL_MS = 400;
const LIVE_CLIP_TICK_MS = 16;

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

  let nextFrameAt = performance.now();
  let lastPeriodMs = getLiveClipPeriodMs(
    servicesManager,
    viewportId,
    options.cinePlayMode,
    fallbackFps
  );

  const intervalId = window.setInterval(() => {
    const liveViewport = getLiveStackViewport(servicesManager, element, viewportId);

    if (!liveViewport) {
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
      // FPS/mode changed: don't wait out the old 1 FPS delay.
      nextFrameAt = Math.min(nextFrameAt, performance.now());
      lastPeriodMs = periodMs;
    }

    const now = performance.now();

    if (now < nextFrameAt) {
      return;
    }

    const liveCount =
      typeof liveViewport.getImageIds === 'function' ? (liveViewport.getImageIds()?.length ?? 0) : 0;

    if (liveCount <= 1) {
      nextFrameAt = now + periodMs;
      return;
    }

    const viewportStatus = liveViewport.viewportStatus;
    if (
      viewportStatus != null &&
      Enums.ViewportStatus?.RENDERED != null &&
      viewportStatus !== Enums.ViewportStatus.RENDERED
    ) {
      // Wait for the first paint. Advancing before RENDERED cancels it and
      // leaves a black viewport until reload.
      nextFrameAt = now + periodMs;
      return;
    }

    let steps = 0;

    while (now >= nextFrameAt && steps < 8) {
      let index = 0;

      try {
        index =
          typeof liveViewport.getCurrentImageIdIndex === 'function'
            ? liveViewport.getCurrentImageIdIndex()
            : 0;
      } catch {
        clearCustomClipByViewportId(viewportId);
        clearCustomClip(element);
        return;
      }

      const nextIndex = (index + frameStep) % liveCount;

      if (nextIndex !== index) {
        try {
          liveViewport.setImageIdIndex(nextIndex);
        } catch {
          clearCustomClipByViewportId(viewportId);
          clearCustomClip(element);
          return;
        }
      }

      nextFrameAt += periodMs;
      steps += 1;
    }

    if (steps >= 8) {
      nextFrameAt = now + periodMs;
    }
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
