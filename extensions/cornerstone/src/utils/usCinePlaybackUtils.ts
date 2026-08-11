import { getViewportEnabledElement } from './cineSyncUtils';
import { getUsCineCapableLayoutViewportIds } from './usGridViewportUtils';
import type { CinePlayMode } from '../components/CinePlayer/usCineUiUtils';

// Keep in sync with DEFAULT_US_FRAME_STEP in usStackCineUtils (avoid circular import).
const DEFAULT_FRAME_STEP = 4;

type CineSettingsUpdate = {
  frameRate?: number;
  cinePlayMode?: CinePlayMode;
  frameStep?: number;
  isPlaying?: boolean;
};

type SharedStudyCineSettings = {
  frameRate: number;
  cinePlayMode: CinePlayMode;
  frameStep: number;
};

/**
 * Shared FPS / fr settings for multi-series layouts (e.g. US 2×2 / 2×4).
 * Prefers the active viewport, then the first cine-capable viewport with state.
 */
function getSharedStudyCineSettings(
  servicesManager: AppTypes.ServicesManager
): SharedStudyCineSettings | null {
  const { cineService, viewportGridService } = servicesManager.services;
  const viewportIds = getUsCineCapableLayoutViewportIds(servicesManager);

  if (!viewportIds.length) {
    return null;
  }

  const { cines } = cineService.getState();
  const { activeViewportId } = viewportGridService.getState();
  const orderedIds =
    activeViewportId && viewportIds.includes(activeViewportId)
      ? [activeViewportId, ...viewportIds.filter(id => id !== activeViewportId)]
      : viewportIds;

  for (const viewportId of orderedIds) {
    const current = cines?.[viewportId];

    if (!current) {
      continue;
    }

    if (current.frameRate != null || current.cinePlayMode != null || current.frameStep != null) {
      return {
        frameRate: current.frameRate ?? 4,
        cinePlayMode: (current.cinePlayMode ?? 'fps') as CinePlayMode,
        frameStep: current.frameStep ?? DEFAULT_FRAME_STEP,
      };
    }
  }

  return null;
}

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
  const { cineService } = servicesManager.services;
  const viewportIds = getUsCineCapableLayoutViewportIds(servicesManager);

  if (!viewportIds.length) {
    return;
  }

  cineService.setIsCineEnabled(true);

  const shared = getSharedStudyCineSettings(servicesManager);

  viewportIds.forEach(viewportId => {
    const { cines } = cineService.getState();
    const current = cines?.[viewportId] ?? {};

    cineService.setCine({
      id: viewportId,
      isPlaying: true,
      frameRate: shared?.frameRate ?? current.frameRate,
      cinePlayMode: shared?.cinePlayMode ?? current.cinePlayMode,
      frameStep: shared?.frameStep ?? current.frameStep,
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
  getSharedStudyCineSettings,
  pauseAllUsViewports,
  playAllUsViewports,
  stepUsViewportFrame,
  stopAllUsViewports,
};
export type { SharedStudyCineSettings };
