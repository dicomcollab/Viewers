import { getEnabledElement } from '@cornerstonejs/core';
import { utilities } from '@cornerstonejs/tools';
import { getSyncedViewports } from './utils/cineSyncUtils';
import { cineDebug, cineDebugError, cineDebugWarn } from './utils/cineDebug';

function initCineService(servicesManager: AppTypes.ServicesManager) {
  const { cineService } = servicesManager.services;

  const getSyncedViewportsForViewport = viewportId => {
    const synced = getSyncedViewports(servicesManager, viewportId);
    cineDebug('initCineService', 'getSyncedViewports', { viewportId, synced });
    return synced;
  };

  const playClip = (element, playClipOptions = {}) => {
    const { viewportId, framesPerSecond } = playClipOptions as {
      viewportId?: string;
      framesPerSecond?: number;
    };

    try {
      const enabledElement = getEnabledElement(element);

      if (!enabledElement) {
        cineDebugWarn('initCineService', 'playClip skipped — element is not a Cornerstone enabled element', {
          viewportId,
          framesPerSecond,
        });
        return;
      }

      const viewport = enabledElement.viewport;
      const numScrollSteps =
        typeof viewport?.getImageIds === 'function' ? viewport.getImageIds()?.length ?? 0 : 0;

      cineDebug('initCineService', 'playClip', {
        viewportId,
        framesPerSecond,
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
