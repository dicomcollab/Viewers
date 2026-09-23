import { getViewportEnabledElement } from './cineSyncUtils';
import { setUserCineFrameRate } from './cineFrameRateOverrideStore';
import { rememberUsViewportFrame } from './usInstanceFrameState';
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
import { shouldSuppressCineAutoplay } from './cineAutoplaySuppress';
import { bumpCineGeneration } from './cineClipStateUtils';
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

function getViewportDisplaySetUid(
  servicesManager: AppTypes.ServicesManager,
  viewportId: string
): string | null {
  const viewports = servicesManager.services.viewportGridService?.getState?.()?.viewports;
  return viewports?.get(viewportId)?.displaySetInstanceUIDs?.[0] ?? null;
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
    const nextFrameRate = settings.frameRate ?? current.frameRate;

    if (settings.frameRate != null) {
      setUserCineFrameRate(
        viewportId,
        getViewportDisplaySetUid(servicesManager, viewportId),
        settings.frameRate
      );
    }

    cineService.setCine({
      id: viewportId,
      frameRate: nextFrameRate,
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
      framesPerSecond: Math.max(1, Math.min(90, Number(current.frameRate) || 1)),
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
 * - syncStart: every US cine viewport in the layout starts from its first frame and
 *   runs its own clip at its own DICOM rate; play/pause covers all of them.
 * - syncPlayback: play/pause is shared across US cine viewports in the layout.
 *
 * Non-US modalities (CT/MR, etc.) always use single-viewport play — sync/autoplay
 * apply to ultrasound only.
 */
function requestCinePlayPause(
  servicesManager: AppTypes.ServicesManager,
  srcViewportId: string,
  playing: boolean,
  mode: CineSyncMode = getCineSyncMode()
): void {
  const { cineService } = servicesManager.services;
  const usViewportIds = getUsCineCapableLayoutViewportIds(servicesManager);

  // CT/MR multi-slice (or any non-US): never sync-play the layout; toggle this tile only.
  if (!usViewportIds.length || !usViewportIds.includes(srcViewportId)) {
    stopSyncPlaybackDriver();
    setSingleViewportPlayState(servicesManager, srcViewportId, playing);
    return;
  }

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

  setStudyCineWantsPlaying(true);
  stopSyncPlaybackDriver();
  cineService.setIsCineEnabled(true);

  if (mode === 'syncStart') {
    // Sync start means every loop begins at its first frame, together.
    resetCineFramesToStart(servicesManager, usViewportIds);
  }

  usViewportIds.forEach(viewportId => {
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
 * FPS changed from a single viewport. Play-sync modes never copy FPS — each
 * clip keeps the rate the doctor set on that bar (US, CT, MR, XA, …).
 */
function applyCineFrameRate(
  servicesManager: AppTypes.ServicesManager,
  srcViewportId: string,
  frameRate: number
): void {
  const { cineService } = servicesManager.services;
  const validFrameRate = Math.max(1, Math.min(90, Math.round(Number(frameRate) || 1)));

  setUserCineFrameRate(
    srcViewportId,
    getViewportDisplaySetUid(servicesManager, srcViewportId),
    validFrameRate
  );
  cineService.setCine({ id: srcViewportId, frameRate: validFrameRate, cinePlayMode: 'fps' });
  restartPlayingCineClips(servicesManager, [srcViewportId]);
}

/**
 * Scrub/step to a frame (1-based). Playback keeps running from that frame —
 * pause/play is not required after using the cine slider or viewport scrollbar.
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
  const viewportIds =
    mode === 'none' ? [srcViewportId] : getUsCineCapableLayoutViewportIds(servicesManager);
  const playingIds = viewportIds.filter(id => cineService.getState().cines?.[id]?.isPlaying);

  setViewportFrameIndex(viewport, frameIndex);
  rememberUsViewportFrame(servicesManager, srcViewportId, frameIndex);

  if (mode === 'syncPlayback' && playingIds.length) {
    mirrorCineFrameToPeers(servicesManager, srcViewportId, frameIndex);
  }

  if (playingIds.length) {
    restartPlayingCineClips(servicesManager, playingIds);
  }
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
  if (shouldSuppressCineAutoplay()) {
    return;
  }

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

  bumpCineGeneration();
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
 * ultrasound cine tile and let CinePlayer start live clips. Play on 1×1 then 2×2
 * used to leave the new tiles showing pause while only the reused first tile moved.
 * Returns true when settled (nothing to do, or every US cine tile is playing).
 *
 * Must never autoplay CT/MR multi-slice stacks — those are not US cine.
 */
function ensureLayoutCinePlayback(servicesManager: AppTypes.ServicesManager): boolean {
  if (shouldSuppressCineAutoplay()) {
    return false;
  }

  if (getCineSyncMode() === 'none' || !getStudyCineWantsPlaying()) {
    return true;
  }

  if (isUsFrameDistributionEnabled()) {
    return true;
  }

  const { cineService } = servicesManager.services;
  const viewportIds = getUsCineCapableLayoutViewportIds(servicesManager);

  // No US multiframe tiles (e.g. CT/MR study) — do not enable or play cine.
  if (!viewportIds.length) {
    return true;
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

  bumpCineGeneration();
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
