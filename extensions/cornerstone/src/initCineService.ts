import { getEnabledElement, utilities as csUtils } from '@cornerstonejs/core';
import { utilities } from '@cornerstonejs/tools';
import { getSyncedViewports } from './utils/cineSyncUtils';
import { cineDebug, cineDebugError, cineDebugWarn } from './utils/cineDebug';

type CustomClipState = {
  intervalId: ReturnType<typeof setInterval>;
};

const customClips = new Map<HTMLElement, CustomClipState>();

export const DEFAULT_FRAME_STEP = 4;
export const STEP_INTERVAL_MS = 400;

function clearCustomClip(element: HTMLElement) {
  const clip = customClips.get(element);

  if (!clip) {
    return;
  }

  clearInterval(clip.intervalId);
  customClips.delete(element);
}

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
    const index =
      typeof viewport.getCurrentImageIdIndex === 'function' ? viewport.getCurrentImageIdIndex() : 0;
    const nextIndex = (index + frameStep) % imageIdCount;

    if (nextIndex !== index) {
      csUtils.jumpToSlice(viewport.element, {
        imageIndex: nextIndex,
        debounceLoading: true,
      });
    }
  }, STEP_INTERVAL_MS);

  customClips.set(element, { intervalId });
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
      const numScrollSteps =
        typeof viewport?.getImageIds === 'function' ? (viewport.getImageIds()?.length ?? 0) : 0;

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
      throw error;
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
      throw error;
    }
  };

  cineService.setServiceImplementation({
    getSyncedViewports: getSyncedViewportsForViewport,
    playClip,
    stopClip,
  });

  cineDebug('initCineService', 'Cine service implementation registered');
}

export default initCineService;
