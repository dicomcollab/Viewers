import { getViewportEnabledElement } from './cineSyncUtils';
import { getUsCineCapableLayoutViewportIds } from './usGridViewportUtils';
import type { CinePlayMode } from '../components/CinePlayer/usCineUiUtils';

type CineSettingsUpdate = {
  frameRate?: number;
  cinePlayMode?: CinePlayMode;
  frameStep?: number;
  isPlaying?: boolean;
};
function applyCineSettingsToAllViewports(
  servicesManager: AppTypes.ServicesManager,
  settings: CineSettingsUpdate
): void {
  const { cineService } = servicesManager.services;
  const viewportIds = getUsCineCapableLayoutViewportIds(servicesManager);

  viewportIds.forEach(viewportId => {
    const { cines } = cineService.getState();
    const current = cines?.[viewportId] ?? {};

    cineService.setCine({
      id: viewportId,
      frameRate: settings.frameRate ?? current.frameRate,
      cinePlayMode: settings.cinePlayMode ?? current.cinePlayMode,
      frameStep: settings.frameStep ?? current.frameStep,
      isPlaying: settings.isPlaying ?? current.isPlaying,
    });
  });
}

function playAllUsViewports(servicesManager: AppTypes.ServicesManager): void {
  const { cineService, displaySetService, viewportGridService } = servicesManager.services;
  const viewportIds = getUsCineCapableLayoutViewportIds(servicesManager);

  if (!viewportIds.length) {
    return;
  }

  cineService.setIsCineEnabled(true);

  viewportIds.forEach(viewportId => {
    const { cines } = cineService.getState();
    const current = cines?.[viewportId] ?? {};

    cineService.setCine({
      id: viewportId,
      isPlaying: true,
      frameRate: current.frameRate,
      cinePlayMode: current.cinePlayMode,
      frameStep: current.frameStep,
    });
  });
}

function pauseAllUsViewports(servicesManager: AppTypes.ServicesManager): void {
  const { cineService, cornerstoneViewportService } = servicesManager.services;
  const viewportIds = getUsCineCapableLayoutViewportIds(servicesManager);

  viewportIds.forEach(viewportId => {
    cineService.setCine({ id: viewportId, isPlaying: false });

    const element = getViewportEnabledElement(cornerstoneViewportService, viewportId);

    if (element) {
      cineService.stopClip(element, { viewportId });
    }
  });
}

function stopAllUsViewports(servicesManager: AppTypes.ServicesManager): void {
  const { cineService, cornerstoneViewportService } = servicesManager.services;
  const viewportIds = getUsCineCapableLayoutViewportIds(servicesManager);

  viewportIds.forEach(viewportId => {
    cineService.setCine({ id: viewportId, isPlaying: false });

    const element = getViewportEnabledElement(cornerstoneViewportService, viewportId);

    if (element) {
      cineService.stopClip(element, { viewportId });
    }

    const viewport = cornerstoneViewportService.getCornerstoneViewport(viewportId);
    viewport?.setImageIdIndex?.(0);
  });
}

function stepUsViewportFrame(
  servicesManager: AppTypes.ServicesManager,
  viewportId: string,
  direction: 1 | -1
): void {
  const { cineService, cornerstoneViewportService } = servicesManager.services;
  const viewport = cornerstoneViewportService.getCornerstoneViewport(viewportId);

  if (!viewport) {
    return;
  }

  const imageIdCount = viewport.getImageIds?.()?.length ?? 0;

  if (imageIdCount <= 1) {
    return;
  }

  cineService.setCine({ id: viewportId, isPlaying: false });

  const currentIndex = viewport.getCurrentImageIdIndex?.() ?? 0;
  let nextIndex = currentIndex + direction;

  if (nextIndex < 0) {
    nextIndex = imageIdCount - 1;
  } else if (nextIndex >= imageIdCount) {
    nextIndex = 0;
  }

  viewport.setImageIdIndex?.(nextIndex);
}

export {
  applyCineSettingsToAllViewports,
  pauseAllUsViewports,
  playAllUsViewports,
  stepUsViewportFrame,
  stopAllUsViewports,
};
