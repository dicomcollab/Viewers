import { getEnabledElement } from '@cornerstonejs/core';
import { utilities } from '@cornerstonejs/tools';
import { getSyncedViewports } from './utils/cineSyncUtils';
import { validateSyncPlaybackDriver } from './utils/usCineSyncPlaybackDriver';
import { isViewportAlive } from './utils/safeViewportFrameUtils';
import { cineDebug, cineDebugError, cineDebugWarn } from './utils/cineDebug';
import { clearCustomClip, setCustomClip } from './utils/cineClipStateUtils';

export const DEFAULT_FRAME_STEP = 4;
export const STEP_INTERVAL_MS = 400;

function playStepStackClip(
  element: HTMLElement,
  playClipOptions: {
    frameStep?: number;
    viewportId?: string;
  }
) {
  const enabledElement = getEnabledElement(element);

  if (!enabledElement) {
    return;
  }

  const viewport = enabledElement.viewport;
  const imageIdCount =
    typeof viewport?.getImageIds === 'function' ? (viewport.getImageIds()?.length ?? 0) : 0;

  if (imageIdCount <= 1) {
    return;
  }

  clearCustomClip(element);

  const frameStep = Math.max(1, Math.round(playClipOptions.frameStep ?? DEFAULT_FRAME_STEP));

  const intervalId = window.setInterval(() => {
    const enabledElement = getEnabledElement(element);
    const liveViewport = enabledElement?.viewport;

    if (!isViewportAlive(liveViewport)) {
      clearCustomClip(element);
      return;
    }

    const liveCount =
      typeof liveViewport.getImageIds === 'function' ? (liveViewport.getImageIds()?.length ?? 0) : 0;

    if (liveCount <= 1) {
      return;
    }

    let index = 0;

    try {
      index =
        typeof liveViewport.getCurrentImageIdIndex === 'function'
          ? liveViewport.getCurrentImageIdIndex()
          : 0;
    } catch {
      clearCustomClip(element);
      return;
    }

    const nextIndex = (index + frameStep) % liveCount;

    if (nextIndex !== index) {
      try {
        liveViewport.setImageIdIndex(nextIndex);
      } catch {
        clearCustomClip(element);
      }
    }
  }, STEP_INTERVAL_MS);

  setCustomClip(element, intervalId);
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
      const enabledElement = getEnabledElement(element);

      if (!enabledElement) {
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

      const viewport = enabledElement.viewport;
      let numScrollSteps = 0;

      try {
        numScrollSteps =
          typeof viewport?.getImageIds === 'function' ? (viewport.getImageIds()?.length ?? 0) : 0;
      } catch {
        cineDebugWarn('initCineService', 'playClip skipped — viewport is no longer usable', {
          viewportId,
        });
        return;
      }

      cineDebug('initCineService', 'playClip', {
        viewportId,
        framesPerSecond,
        cinePlayMode,
        frameStep,
        cornerstoneViewportId: viewport?.id,
        viewportType: viewport?.type,
        numScrollSteps,
      });

      if (numScrollSteps <= 1) {
        cineDebugWarn('initCineService', 'playClip — stack has ≤1 frame; cine cannot advance', {
          viewportId,
          numScrollSteps,
        });
      }

      utilities.cine.stopClip(element, { viewportId });
      clearCustomClip(element);

      if (cinePlayMode === 'step') {
        cineDebug('initCineService', 'playStepStackClip', {
          viewportId,
          frameStep,
          numScrollSteps,
        });
        playStepStackClip(element, playClipOptions);
        return;
      }

      return utilities.cine.playClip(element, playClipOptions);
    } catch (error) {
      cineDebugError('initCineService', 'playClip failed', error);
    }
  };

  const stopClip = (element, stopClipOptions = {}) => {
    const { viewportId } = stopClipOptions as { viewportId?: string };

    cineDebug('initCineService', 'stopClip', { viewportId });

    try {
      clearCustomClip(element);
      return utilities.cine.stopClip(element, stopClipOptions);
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

  viewportGridService.subscribe(viewportGridService.EVENTS.GRID_STATE_CHANGED, () =>
    validateSyncPlaybackDriver(servicesManager)
  );

  cineDebug('initCineService', 'Cine service implementation registered');
}

export default initCineService;
