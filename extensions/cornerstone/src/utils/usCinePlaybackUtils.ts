import { getViewportEnabledElement } from './cineSyncUtils';
import {
  getAliveViewport,
  getViewportFrameCount,
  getViewportFrameIndex,
  setViewportFrameIndex,
} from './safeViewportFrameUtils';
import { getUsCineCapableLayoutViewportIds, getUsLayoutViewportIds } from './usGridViewportUtils';
import { getCineSyncMode, type CineSyncMode } from './cineSyncModeStore';
import {
  alignFollowersToFrame,
  startSyncStartDriver,
  stopSyncPlaybackDriver,
} from './usCineSyncPlaybackDriver';
import { getStudyCineWantsPlaying, setStudyCineWantsPlaying } from './cinePlaybackIntent';
import {
  getUsFrameDistributionBatchStart,
  isUsFrameDistributionEnabled,
} from '@ohif/extension-default';
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
 * Shared play-mode / frame-step for multi-series layouts (e.g. US 2×2 / 2×4).
 * Prefers the active viewport, then the first cine-capable viewport with state.
 * Does not share frameRate — each instance keeps its DICOM-derived FPS.
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

    if (current.cinePlayMode != null || current.frameStep != null) {
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

/**
 * Restart native clips for viewports that are already playing so FPS / FR
 * changes take effect without requiring pause then play.
 */
function restartPlayingCineClips(
  servicesManager: AppTypes.ServicesManager,
  viewportIds?: string[]
): void {
  const { cineService, cornerstoneViewportService } = servicesManager.services;
  const ids = viewportIds ?? getUsCineCapableLayoutViewportIds(servicesManager);

  ids.forEach(viewportId => {
    const current = cineService.getState().cines?.[viewportId];

    if (!current?.isPlaying) {
      return;
    }

    const viewport = getAliveViewport(cornerstoneViewportService, viewportId);
    const element = viewport?.element;

    if (!element) {
      return;
    }

    cineService.playClip(element, {
      framesPerSecond: Math.max(1, Number(current.frameRate) || 1),
      viewportId,
      cinePlayMode: current.cinePlayMode ?? 'fps',
      frameStep: current.frameStep,
    });
  });
}

/**
 * Rewind the given viewports to their first frame so synced playback starts aligned.
 * In Frame Distribution the "start" is the current group offset (N, N+1, N+2, …).
 */
function resetCineFramesToStart(
  servicesManager: AppTypes.ServicesManager,
  viewportIds: string[]
): void {
  const { cornerstoneViewportService } = servicesManager.services;
  const layoutViewportIds = getUsLayoutViewportIds(servicesManager);
  const distributed = isUsFrameDistributionEnabled() && layoutViewportIds.length > 1;
  const batchStart = distributed ? getUsFrameDistributionBatchStart() : 0;

  viewportIds.forEach(viewportId => {
    const viewport = getAliveViewport(cornerstoneViewportService, viewportId);
    const imageIdCount = getViewportFrameCount(viewport);

    if (imageIdCount <= 1) {
      return;
    }

    const layoutIndex = layoutViewportIds.indexOf(viewportId);
    const targetIndex = distributed
      ? Math.min(batchStart + Math.max(0, layoutIndex), imageIdCount - 1)
      : 0;
    setViewportFrameIndex(viewport, targetIndex);
  });
}

/**
 * Move the other cine viewports to the frame matching this viewport's position
 * (sync playback only). Loops of different lengths are matched relatively.
 */
function mirrorCineFrameToPeers(
  servicesManager: AppTypes.ServicesManager,
  srcViewportId: string,
  frameIndex: number
): void {
  const { cornerstoneViewportService } = servicesManager.services;
  const frameCount =
    cornerstoneViewportService.getCornerstoneViewport(srcViewportId)?.getImageIds?.()?.length ?? 0;

  alignFollowersToFrame(servicesManager, srcViewportId, frameIndex, frameCount);
}

function setSingleViewportPlayState(
  servicesManager: AppTypes.ServicesManager,
  viewportId: string,
  playing: boolean
): void {
  const { cineService, cornerstoneViewportService } = servicesManager.services;
  const current = cineService.getState().cines?.[viewportId] ?? {};

  if (playing) {
    cineService.setIsCineEnabled(true);
    setStudyCineWantsPlaying(true);
  } else {
    setStudyCineWantsPlaying(false);
  }

  cineService.setCine({
    id: viewportId,
    isPlaying: playing,
    frameRate: current.frameRate,
    cinePlayMode: current.cinePlayMode ?? 'fps',
    frameStep: current.frameStep,
  });

  if (!playing) {
    const element = getViewportEnabledElement(cornerstoneViewportService, viewportId);

    if (element) {
      cineService.stopClip(element, { viewportId });
    }
  }
}

/**
 * Play/pause requested from a single viewport, honouring the active sync mode.
 *
 * - none: only this viewport starts or stops.
 * - syncStart: every cine viewport in the layout starts from its first frame and
 *   runs its own clip at its own DICOM rate; play/pause covers all of them.
 * - syncPlayback: play/pause is shared across the layout, matching the study
 *   header control; each loop otherwise keeps its normal playback.
 */
function requestCinePlayPause(
  servicesManager: AppTypes.ServicesManager,
  srcViewportId: string,
  playing: boolean,
  mode: CineSyncMode = getCineSyncMode()
): void {
  const { cineService } = servicesManager.services;

  if (mode === 'none') {
    stopSyncPlaybackDriver();
    setSingleViewportPlayState(servicesManager, srcViewportId, playing);
    return;
  }

  if (!playing) {
    setStudyCineWantsPlaying(false);
    pauseAllUsViewports(servicesManager);
    return;
  }

  const viewportIds = getUsCineCapableLayoutViewportIds(servicesManager);

  if (!viewportIds.length) {
    return;
  }

  setStudyCineWantsPlaying(true);
  stopSyncPlaybackDriver();
  cineService.setIsCineEnabled(true);

  if (mode === 'syncStart') {
    // Sync start means every loop begins at its first frame, together.
    resetCineFramesToStart(servicesManager, viewportIds);
  }

  viewportIds.forEach(viewportId => {
    const current = cineService.getState().cines?.[viewportId] ?? {};

    cineService.setCine({
      id: viewportId,
      isPlaying: true,
      frameRate: current.frameRate,
      cinePlayMode: current.cinePlayMode ?? 'fps',
      frameStep: current.frameStep,
    });
  });

  if (mode === 'syncStart') {
    startSyncStartDriver(servicesManager);
  }
}

/**
 * FPS changed from a single viewport: shared in sync playback, local otherwise.
 */
function applyCineFrameRate(
  servicesManager: AppTypes.ServicesManager,
  srcViewportId: string,
  frameRate: number,
  mode: CineSyncMode = getCineSyncMode()
): void {
  const { cineService } = servicesManager.services;
  const validFrameRate = Math.max(1, Math.round(Number(frameRate) || 1));

  if (mode === 'syncPlayback') {
    applyCineSettingsToAllViewports(servicesManager, {
      frameRate: validFrameRate,
      cinePlayMode: 'fps',
    });
    restartPlayingCineClips(servicesManager);
    return;
  }

  cineService.setCine({ id: srcViewportId, frameRate: validFrameRate, cinePlayMode: 'fps' });
  restartPlayingCineClips(servicesManager, [srcViewportId]);
}

/**
 * Scrub/step to a frame (1-based). Any sync mode pauses the whole layout so play
 * state stays consistent, but the requested frame belongs to this viewport.
 */
function requestCineFrameChange(
  servicesManager: AppTypes.ServicesManager,
  srcViewportId: string,
  frame: number,
  mode: CineSyncMode = getCineSyncMode()
): void {
  const { cineService, cornerstoneViewportService } = servicesManager.services;
  const viewport = getAliveViewport(cornerstoneViewportService, srcViewportId);
  const imageIdCount = getViewportFrameCount(viewport);
  const frameIndex = Math.max(0, Math.min(Math.max(0, imageIdCount - 1), frame - 1));

  if (mode === 'none') {
    cineService.setCine({ id: srcViewportId, isPlaying: false });
  } else {
    pauseAllUsViewports(servicesManager);
  }

  setViewportFrameIndex(viewport, frameIndex);
}

/**
 * Bring viewports in line with a freshly picked sync mode so the change is
 * visible right away instead of on the next play press.
 */
function applyCineSyncMode(
  servicesManager: AppTypes.ServicesManager,
  mode: CineSyncMode
): void {
  stopSyncPlaybackDriver();

  const { cineService, viewportGridService } = servicesManager.services;
  const viewportIds = getUsCineCapableLayoutViewportIds(servicesManager);

  if (!viewportIds.length) {
    return;
  }

  const { cines } = cineService.getState();
  const { activeViewportId } = viewportGridService.getState();
  const referenceViewportId =
    (activeViewportId && viewportIds.includes(activeViewportId) ? activeViewportId : null) ??
    viewportIds.find(viewportId => cines?.[viewportId]?.isPlaying) ??
    viewportIds[0];
  const isAnyPlaying = viewportIds.some(viewportId => cines?.[viewportId]?.isPlaying);

  if (isAnyPlaying) {
    // Force the old playback implementation to stop before the new mode takes
    // over. The next task lets React apply the paused state first.
    pauseAllUsViewports(servicesManager);

    if (mode !== 'none') {
      window.setTimeout(
        () => requestCinePlayPause(servicesManager, referenceViewportId, true, mode),
        0
      );
    }
  }
}

function playAllUsViewports(servicesManager: AppTypes.ServicesManager): void {
  const { cineService, viewportGridService } = servicesManager.services;
  const viewportIds = getUsCineCapableLayoutViewportIds(servicesManager);

  if (!viewportIds.length) {
    return;
  }

  const mode = getCineSyncMode();

  if (mode !== 'none') {
    const { activeViewportId } = viewportGridService.getState();
    const master =
      activeViewportId && viewportIds.includes(activeViewportId) ? activeViewportId : viewportIds[0];

    requestCinePlayPause(servicesManager, master, true, mode);
    return;
  }

  cineService.setIsCineEnabled(true);

  viewportIds.forEach(viewportId => {
    const { cines } = cineService.getState();
    const current = cines?.[viewportId] ?? {};

    // Sync play state only — keep each viewport's own DICOM-derived frameRate.
    cineService.setCine({
      id: viewportId,
      isPlaying: true,
      frameRate: current.frameRate,
      cinePlayMode: current.cinePlayMode ?? 'fps',
      frameStep: current.frameStep,
    });
  });
}

function getAllKnownCineViewportIds(servicesManager: AppTypes.ServicesManager): string[] {
  const { cineService } = servicesManager.services;
  const layoutIds = getUsCineCapableLayoutViewportIds(servicesManager);
  const stateIds = Object.keys(cineService.getState().cines || {});

  return Array.from(new Set([...layoutIds, ...stateIds]));
}

function pauseAllUsViewports(servicesManager: AppTypes.ServicesManager): void {
  const { cineService, cornerstoneViewportService } = servicesManager.services;
  const viewportIds = getAllKnownCineViewportIds(servicesManager);

  stopSyncPlaybackDriver();

  viewportIds.forEach(viewportId => {
    cineService.setCine({ id: viewportId, isPlaying: false });

    const element = getViewportEnabledElement(cornerstoneViewportService, viewportId);

    if (element) {
      cineService.stopClip(element, { viewportId });
    }
  });
}

/**
 * After a hanging-protocol / grid resize, copy study play intent onto every
 * cine tile and let CinePlayer start live clips. Play on 1×1 then 2×2 used to
 * leave the new tiles showing pause while only the reused first tile moved.
 * Returns true when every cine tile is already marked playing.
 */
function ensureLayoutCinePlayback(servicesManager: AppTypes.ServicesManager): boolean {
  if (getCineSyncMode() === 'none' || !getStudyCineWantsPlaying()) {
    return true;
  }

  if (isUsFrameDistributionEnabled()) {
    return true;
  }

  const { cineService } = servicesManager.services;
  const viewportIds = getUsCineCapableLayoutViewportIds(servicesManager);

  if (!viewportIds.length) {
    return false;
  }

  cineService.setIsCineEnabled(true);

  viewportIds.forEach(viewportId => {
    const current = cineService.getState().cines?.[viewportId] ?? {};

    if (current.isPlaying) {
      return;
    }

    cineService.setCine({
      id: viewportId,
      isPlaying: true,
      frameRate: current.frameRate,
      cinePlayMode: current.cinePlayMode ?? 'fps',
      frameStep: current.frameStep,
    });
  });

  return viewportIds.every(
    viewportId => cineService.getState().cines?.[viewportId]?.isPlaying
  );
}

function stopAllUsViewports(servicesManager: AppTypes.ServicesManager): void {
  const { cineService, cornerstoneViewportService } = servicesManager.services;
  const viewportIds = getUsCineCapableLayoutViewportIds(servicesManager);

  stopSyncPlaybackDriver();

  viewportIds.forEach(viewportId => {
    cineService.setCine({ id: viewportId, isPlaying: false });

    const element = getViewportEnabledElement(cornerstoneViewportService, viewportId);

    if (element) {
      cineService.stopClip(element, { viewportId });
    }
  });

  resetCineFramesToStart(servicesManager, viewportIds);
}

function stepUsViewportFrame(
  servicesManager: AppTypes.ServicesManager,
  viewportId: string,
  direction: 1 | -1
): void {
  const { cineService, cornerstoneViewportService } = servicesManager.services;
  const viewport = getAliveViewport(cornerstoneViewportService, viewportId);

  if (!viewport) {
    return;
  }

  const imageIdCount = getViewportFrameCount(viewport);

  if (imageIdCount <= 1) {
    return;
  }

  cineService.setCine({ id: viewportId, isPlaying: false });

  const currentIndex = getViewportFrameIndex(viewport);
  let nextIndex = currentIndex + direction;

  if (nextIndex < 0) {
    nextIndex = imageIdCount - 1;
  } else if (nextIndex >= imageIdCount) {
    nextIndex = 0;
  }

  setViewportFrameIndex(viewport, nextIndex);
}

export {
  applyCineFrameRate,
  applyCineSettingsToAllViewports,
  applyCineSyncMode,
  ensureLayoutCinePlayback,
  getSharedStudyCineSettings,
  mirrorCineFrameToPeers,
  pauseAllUsViewports,
  playAllUsViewports,
  requestCineFrameChange,
  requestCinePlayPause,
  resetCineFramesToStart,
  stepUsViewportFrame,
  stopAllUsViewports,
};
export type { SharedStudyCineSettings };
