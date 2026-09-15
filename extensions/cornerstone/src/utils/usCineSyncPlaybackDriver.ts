import { Enums } from '@cornerstonejs/core';
import { getUsCineCapableLayoutViewportIds } from './usGridViewportUtils';
import {
  getAliveViewport,
  getViewportFrameCount,
  getViewportFrameIndex,
  getViewportStackKey,
  setViewportFrameIndex,
  setViewportFrameIndexAsync,
} from './safeViewportFrameUtils';
import {
  isStackFrameReady,
  prefetchStackFrame,
  prefetchUpcomingStackFrames,
} from './cineFrameLoadUtils';
import { getCineGeneration } from './cineClipStateUtils';

/**
 * Sync playback driver.
 *
 * Only the master viewport runs a cine clip; every other cine viewport follows
 * it frame by frame. Loops of different lengths are matched by relative
 * position, so frame 50 of a 100-frame loop lands on frame 25 of a 50-frame
 * loop — the equivalent point of the same cardiac cycle.
 */
type SyncPlaybackDriverState = {
  mode: 'syncPlayback';
  masterViewportId: string;
  element: HTMLElement;
  listener: EventListener;
};

type SyncStartViewportState = {
  viewportId: string;
  frameCount: number;
  frameRate: number;
  frameIndex: number;
  nextFrameAt: number;
  advanceInFlight: boolean;
};

type SyncStartDriverState = {
  mode: 'syncStart';
  viewportIds: string[];
  intervalId: ReturnType<typeof setInterval>;
  cleanups: Array<() => void>;
};

type DriverState = SyncPlaybackDriverState | SyncStartDriverState;

let driver: DriverState | null = null;

function getFrameInfo(cornerstoneViewportService, viewportId: string) {
  const viewport = getAliveViewport(cornerstoneViewportService, viewportId);

  return {
    viewport,
    frameCount: getViewportFrameCount(viewport),
    frameIndex: getViewportFrameIndex(viewport),
  };
}

/**
 * Frame in `frameCount` frames that matches the same relative position.
 */
export function getCorrespondingFrameIndex(
  sourceIndex: number,
  sourceFrameCount: number,
  frameCount: number
): number {
  if (frameCount <= 1) {
    return 0;
  }

  if (sourceFrameCount <= 1) {
    return Math.max(0, Math.min(frameCount - 1, sourceIndex));
  }

  const ratio = Math.max(0, Math.min(1, sourceIndex / (sourceFrameCount - 1)));

  return Math.round(ratio * (frameCount - 1));
}

/**
 * Move every follower viewport to the frame matching the master's position.
 */
export function alignFollowersToFrame(
  servicesManager: AppTypes.ServicesManager,
  masterViewportId: string,
  masterFrameIndex: number,
  masterFrameCount: number
): void {
  const { cornerstoneViewportService } = servicesManager.services;

  getUsCineCapableLayoutViewportIds(servicesManager).forEach(viewportId => {
    if (viewportId === masterViewportId) {
      return;
    }

    const { viewport, frameCount, frameIndex } = getFrameInfo(
      cornerstoneViewportService,
      viewportId
    );

    if (!viewport || frameCount <= 1) {
      return;
    }

    const targetIndex = getCorrespondingFrameIndex(
      masterFrameIndex,
      masterFrameCount,
      frameCount
    );

    if (targetIndex === frameIndex) {
      return;
    }

    setViewportFrameIndex(viewport, targetIndex);
  });
}

export function stopSyncPlaybackDriver(): void {
  if (!driver) {
    return;
  }

  if (driver.mode === 'syncPlayback') {
    try {
      driver.element.removeEventListener(Enums.Events.STACK_NEW_IMAGE, driver.listener);
    } catch {
      // Element may already be detached after a layout swap.
    }
  } else {
    clearInterval(driver.intervalId);
    driver.cleanups.forEach(cleanup => cleanup());
  }

  driver = null;
}

/**
 * Drive every follower viewport from the master's frame changes.
 */
export function startSyncPlaybackDriver(
  servicesManager: AppTypes.ServicesManager,
  masterViewportId: string
): void {
  stopSyncPlaybackDriver();

  const { cornerstoneViewportService } = servicesManager.services;
  const { viewport, frameCount, frameIndex } = getFrameInfo(
    cornerstoneViewportService,
    masterViewportId
  );
  const element = viewport?.element;

  if (!element || frameCount <= 1) {
    return;
  }

  const listener = () => {
    if (driver?.mode !== 'syncPlayback' || driver.masterViewportId !== masterViewportId) {
      return;
    }

    const master = getFrameInfo(cornerstoneViewportService, masterViewportId);

    if (!master.viewport || master.frameCount <= 1) {
      stopSyncPlaybackDriver();
      return;
    }

    alignFollowersToFrame(
      servicesManager,
      masterViewportId,
      master.frameIndex,
      master.frameCount
    );
  };

  element.addEventListener(Enums.Events.STACK_NEW_IMAGE, listener);
  driver = { mode: 'syncPlayback', masterViewportId, element, listener };

  alignFollowersToFrame(servicesManager, masterViewportId, frameIndex, frameCount);
}

/**
 * Start every loop at frame 1. A shorter/faster loop waits on its final frame
 * until every loop has finished; only then does the complete layout restart.
 *
 * Advances one frame at a time after that frame is cached and painted. Catch-up
 * skips are not used — they move the bar while cancelling in-flight renders.
 */
export function startSyncStartDriver(
  servicesManager: AppTypes.ServicesManager,
  frameRateOverrides: Record<string, number> = {}
): void {
  stopSyncPlaybackDriver();

  const { cornerstoneViewportService, cineService } = servicesManager.services;
  const now = performance.now();
  const { cines } = cineService.getState();
  const viewportStates: SyncStartViewportState[] = getUsCineCapableLayoutViewportIds(
    servicesManager
  )
    .map(viewportId => {
      const { viewport, frameCount } = getFrameInfo(cornerstoneViewportService, viewportId);
      const frameRate = Math.max(
        1,
        Number(frameRateOverrides[viewportId] ?? cines?.[viewportId]?.frameRate) || 1
      );

      if (!viewport || frameCount <= 1) {
        return null;
      }

      setViewportFrameIndex(viewport, 0);

      return {
        viewportId,
        frameCount,
        frameRate,
        frameIndex: 0,
        nextFrameAt: now + 1000 / frameRate,
        advanceInFlight: false,
      };
    })
    .filter(Boolean) as SyncStartViewportState[];

  if (!viewportStates.length) {
    return;
  }

  const clipGeneration = getCineGeneration();
  const frameOptions = (viewportId: string, viewport) => ({
    viewportId,
    cornerstoneViewportService,
    generation: clipGeneration,
    getGeneration: getCineGeneration,
    stackKey: getViewportStackKey(viewport),
  });

  const intervalId = window.setInterval(() => {
    if (driver?.mode !== 'syncStart' || getCineGeneration() !== clipGeneration) {
      return;
    }

    const tickNow = performance.now();

    viewportStates.forEach(state => {
      if (state.advanceInFlight || state.frameIndex >= state.frameCount - 1 || tickNow < state.nextFrameAt) {
        return;
      }

      const nextIndex = state.frameIndex + 1;
      const viewport = getAliveViewport(cornerstoneViewportService, state.viewportId);
      const imageIds = viewport?.getImageIds?.() ?? [];
      const nextImageId = imageIds[nextIndex];

      prefetchUpcomingStackFrames(imageIds, state.frameIndex);

      if (!isStackFrameReady(nextImageId)) {
        prefetchStackFrame(nextImageId);
        return;
      }

      state.advanceInFlight = true;
      void setViewportFrameIndexAsync(viewport, nextIndex, frameOptions(state.viewportId, viewport))
        .then(ok => {
          if (ok) {
            state.frameIndex = nextIndex;
          }
          state.nextFrameAt = performance.now() + 1000 / state.frameRate;
        })
        .finally(() => {
          state.advanceInFlight = false;
        });
    });

    if (
      !viewportStates.every(state => state.frameIndex === state.frameCount - 1 && !state.advanceInFlight)
    ) {
      return;
    }

    const firstIdsReady = viewportStates.every(state => {
      const viewport = getAliveViewport(cornerstoneViewportService, state.viewportId);
      return isStackFrameReady(viewport?.getImageIds?.()?.[0]);
    });

    if (!firstIdsReady) {
      viewportStates.forEach(state => {
        const viewport = getAliveViewport(cornerstoneViewportService, state.viewportId);
        prefetchStackFrame(viewport?.getImageIds?.()?.[0]);
      });
      return;
    }

    const restartAt = performance.now();
    viewportStates.forEach(state => {
      if (state.advanceInFlight) {
        return;
      }

      const viewport = getAliveViewport(cornerstoneViewportService, state.viewportId);
      state.advanceInFlight = true;
      void setViewportFrameIndexAsync(viewport, 0, frameOptions(state.viewportId, viewport))
        .then(ok => {
          if (ok) {
            state.frameIndex = 0;
          }
          state.nextFrameAt = restartAt + 1000 / state.frameRate;
        })
        .finally(() => {
          state.advanceInFlight = false;
        });
    });
  }, 16);

  driver = {
    mode: 'syncStart',
    viewportIds: viewportStates.map(state => state.viewportId),
    intervalId,
    cleanups: [],
  };
}

export function getSyncPlaybackMasterViewportId(): string | null {
  return driver?.mode === 'syncPlayback' ? driver.masterViewportId : null;
}

/**
 * Whichever viewport the user last moved owns the sync for a short window, so
 * the frames it pushes onto the followers cannot bounce back at it.
 */
const MANUAL_SYNC_OWNER_MS = 250;
let manualSyncOwner: { viewportId: string; until: number } | null = null;

/**
 * Keep frame navigation synced while nothing is playing (wheel, stack scroll,
 * slider or frame buttons) — the manual half of sync playback.
 */
export function syncManualFrameScroll(
  servicesManager: AppTypes.ServicesManager,
  viewportId: string
): void {
  if (driver) {
    // Playback already drives the followers from the master.
    return;
  }

  const now = Date.now();

  if (manualSyncOwner && manualSyncOwner.viewportId !== viewportId && now < manualSyncOwner.until) {
    return;
  }

  const { cornerstoneViewportService } = servicesManager.services;
  const { viewport, frameCount, frameIndex } = getFrameInfo(cornerstoneViewportService, viewportId);

  if (!viewport || frameCount <= 1) {
    return;
  }

  manualSyncOwner = { viewportId, until: now + MANUAL_SYNC_OWNER_MS };

  alignFollowersToFrame(servicesManager, viewportId, frameIndex, frameCount);
}

/**
 * True when this viewport is being driven by another viewport's playback, so it
 * must not run a clip of its own.
 */
export function isSyncPlaybackFollower(viewportId: string): boolean {
  return driver?.mode === 'syncPlayback' && driver.masterViewportId !== viewportId;
}

/** Native cine must be suppressed while a viewport is controlled by a driver. */
export function isCinePlaybackManaged(viewportId: string): boolean {
  if (driver?.mode === 'syncStart') {
    return driver.viewportIds.includes(viewportId);
  }

  return driver?.mode === 'syncPlayback' && driver.masterViewportId !== viewportId;
}

export function isSyncPlaybackDriverActive(): boolean {
  return !!driver;
}

/**
 * Drop the driver once its master viewport leaves the layout (layout change,
 * new hanging protocol, …) so nothing stays pinned to a dead viewport.
 */
export function validateSyncPlaybackDriver(servicesManager: AppTypes.ServicesManager): void {
  if (!driver) {
    return;
  }

  const { cornerstoneViewportService } = servicesManager.services;
  const layoutIds = getUsCineCapableLayoutViewportIds(servicesManager);
  const stillInLayout =
    driver.mode === 'syncPlayback'
      ? layoutIds.includes(driver.masterViewportId)
      : driver.viewportIds.every(viewportId => layoutIds.includes(viewportId));

  const masterAlive =
    driver.mode !== 'syncPlayback' ||
    Boolean(getAliveViewport(cornerstoneViewportService, driver.masterViewportId));

  if (!stillInLayout || !masterAlive) {
    stopSyncPlaybackDriver();
  }
}
