import { Enums } from '@cornerstonejs/core';
import { getUsCineCapableLayoutViewportIds } from './usGridViewportUtils';
import {
  getAliveViewport,
  getViewportFrameCount,
  getViewportFrameIndex,
  getViewportStackKey,
  hasViewportPaintedFirstImage,
  repairUnboundStackViewport,
  setViewportFrameIndex,
  setViewportFrameIndexAsync,
} from './safeViewportFrameUtils';
import { isStackFrameReady } from './cineFrameLoadUtils';
import { getCineGeneration } from './cineClipStateUtils';
import {
  canShowClipFrame,
  ensureViewportClipBuffered,
  isClipFrameFailed,
} from './usClipBufferStore';
import {
  getCineResumeFrames,
  getCineStartFrames,
  hasCineBuffer,
  isCineBufferingEnabled,
} from './cineBufferPolicy';
import { countPerf, recordPerfTiming } from './viewerPerfMetrics';

/** Decoded and resident, or failed for good (shown empty rather than held for). */
export function isCineFramePlayable(imageId: string | undefined): boolean {
  return isStackFrameReady(imageId) || isClipFrameFailed(imageId);
}
import { getCinePlayhead, setCinePlayhead, subscribeCinePlayhead } from './cinePlayheadStore';
import { registerCineTick, unregisterCineTick } from './cineSharedTicker';

const FPS_MIN = 1;
const FPS_MAX = 90;
const SYNC_START_TICK_ID = 'syncStart';

function clampFrameRate(value: number): number {
  return Math.max(FPS_MIN, Math.min(FPS_MAX, Number(value) || FPS_MIN));
}

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
  cleanups: Array<() => void>;
};

type SyncStartViewportState = {
  viewportId: string;
  stackKey: string | null;
  frameCount: number;
  frameRate: number;
  /** Last cineService rate seen; a change means the doctor moved the FPS control. */
  lastLiveFrameRate: number;
  /** Playhead of this pass, -1 before the pass shows its first frame. */
  frameIndex: number;
  playheadReady: boolean;
  passStartAt: number;
  /** Tile gone or still binding its first image: it never holds the layout restart. */
  inactive: boolean;
  advanceInFlight: boolean;
  /** Holding on `frameIndex` until enough frames after it are decoded. */
  buffering: boolean;
  bufferingSince: number;
};

type SyncStartDriverState = {
  mode: 'syncStart';
  viewportIds: string[];
  tickId: string;
  cleanups: Array<() => void>;
};

type DriverState = SyncPlaybackDriverState | SyncStartDriverState;

let driver: DriverState | null = null;
/** Tiles whose empty-frame playhead was set by a driver (cleared when it stops). */
const drivenPlayheadIds = new Set<string>();

function setDrivenPlayhead(
  viewportId: string,
  playhead: { index: number; total: number; ready: boolean } | null
) {
  if (playhead) {
    drivenPlayheadIds.add(viewportId);
  } else {
    drivenPlayheadIds.delete(viewportId);
  }
  setCinePlayhead(viewportId, playhead);
}

function clearDrivenPlayheads() {
  Array.from(drivenPlayheadIds).forEach(viewportId => setCinePlayhead(viewportId, null));
  drivenPlayheadIds.clear();
}

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
 *
 * With `onlyDecodedFrames` (playback), a follower whose target frame is still
 * downloading shows an empty frame for that position instead — calling
 * setImageIdIndex on an uncached frame every master tick would cancel each
 * in-flight swap, so the follower would never paint.
 */
export function alignFollowersToFrame(
  servicesManager: AppTypes.ServicesManager,
  masterViewportId: string,
  masterFrameIndex: number,
  masterFrameCount: number,
  { onlyDecodedFrames = false }: { onlyDecodedFrames?: boolean } = {}
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

    const targetIndex = getCorrespondingFrameIndex(masterFrameIndex, masterFrameCount, frameCount);

    // A follower still binding must not be moved: that cancels its first load
    // and leaves the tile black under the overlay. One whose bind ended without
    // an image gets the matching decoded frame put up instead.
    if (!hasViewportPaintedFirstImage(viewport, { allowSwapInFlight: true })) {
      repairUnboundStackViewport(viewport, targetIndex);
      return;
    }

    if (onlyDecodedFrames) {
      const imageIds = viewport.getImageIds?.() ?? [];

      if (!isStackFrameReady(imageIds[targetIndex])) {
        // Evicted after downloading: keep the last picture while it reloads.
        setDrivenPlayhead(viewportId, {
          index: targetIndex,
          total: frameCount,
          ready: canShowClipFrame(imageIds[targetIndex]),
        });
        return;
      }

      // Mid-swap: catch up on the master's next frame instead of cancelling it.
      if (!hasViewportPaintedFirstImage(viewport)) {
        return;
      }

      setDrivenPlayhead(viewportId, { index: targetIndex, total: frameCount, ready: true });
    }

    if (targetIndex === frameIndex) {
      return;
    }

    setViewportFrameIndex(viewport, targetIndex);
  });
}

/**
 * For the sync master: whether every follower's matching frame for a master
 * position is playable, so the whole layout buffers together instead of
 * followers showing empty frames. Null when `masterViewportId` drives no sync.
 * Followers still binding their first image do not hold playback.
 */
export function createSyncFollowerFrameCheck(
  servicesManager: AppTypes.ServicesManager,
  masterViewportId: string | undefined,
  isPlayable: (imageId: string | undefined) => boolean
): ((masterIndex: number, masterFrameCount: number) => boolean) | null {
  if (
    !masterViewportId ||
    driver?.mode !== 'syncPlayback' ||
    driver.masterViewportId !== masterViewportId
  ) {
    return null;
  }

  const { cornerstoneViewportService } = servicesManager.services;
  const followers = getUsCineCapableLayoutViewportIds(servicesManager)
    .filter(viewportId => viewportId !== masterViewportId)
    .map(viewportId => getFrameInfo(cornerstoneViewportService, viewportId))
    .filter(
      ({ viewport, frameCount }) =>
        viewport &&
        frameCount > 1 &&
        hasViewportPaintedFirstImage(viewport, { allowSwapInFlight: true })
    )
    .map(({ viewport, frameCount }) => ({
      frameCount,
      imageIds: (viewport.getImageIds?.() ?? []) as string[],
    }));

  if (!followers.length) {
    return null;
  }

  return (masterIndex, masterFrameCount) =>
    followers.every(({ frameCount, imageIds }) =>
      isPlayable(imageIds[getCorrespondingFrameIndex(masterIndex, masterFrameCount, frameCount)])
    );
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
    unregisterCineTick(driver.tickId);
  }

  driver.cleanups.forEach(cleanup => cleanup());
  driver = null;
  clearDrivenPlayheads();
}

/**
 * Drive every follower viewport from the master's frame changes. The master's
 * cine timeline (including frames it shows as empty) is the source; plain
 * STACK_NEW_IMAGE covers a master that has no timeline.
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

  const isCurrent = () =>
    driver?.mode === 'syncPlayback' && driver.masterViewportId === masterViewportId;

  const listener = () => {
    if (!isCurrent() || getCinePlayhead(masterViewportId)) {
      return;
    }

    const master = getFrameInfo(cornerstoneViewportService, masterViewportId);

    if (!master.viewport || master.frameCount <= 1) {
      stopSyncPlaybackDriver();
      return;
    }

    alignFollowersToFrame(servicesManager, masterViewportId, master.frameIndex, master.frameCount, {
      onlyDecodedFrames: true,
    });
  };

  const unsubscribePlayhead = subscribeCinePlayhead((id, playhead) => {
    if (id !== masterViewportId || !playhead || !isCurrent()) {
      return;
    }

    alignFollowersToFrame(servicesManager, masterViewportId, playhead.index, playhead.total, {
      onlyDecodedFrames: true,
    });
  });

  element.addEventListener(Enums.Events.STACK_NEW_IMAGE, listener);
  driver = {
    mode: 'syncPlayback',
    masterViewportId,
    element,
    listener,
    cleanups: [unsubscribePlayhead],
  };

  alignFollowersToFrame(servicesManager, masterViewportId, frameIndex, frameCount, {
    onlyDecodedFrames: true,
  });
}

/**
 * Start every loop at frame 1. Each tile walks its own frames 1..N at its own
 * FPS on a fixed timeline (position from elapsed time, so the cadence never
 * drifts). A frame still downloading shows as an empty frame and appears on a
 * later pass once it has arrived. A shorter/faster loop waits on its final
 * frame until every loop has finished; only then does the layout restart.
 */
export function startSyncStartDriver(
  servicesManager: AppTypes.ServicesManager,
  frameRateOverrides: Record<string, number> = {}
): void {
  stopSyncPlaybackDriver();

  const { cornerstoneViewportService, cineService } = servicesManager.services;
  const now = performance.now();
  const { cines } = cineService.getState();
  const readLiveFrameRate = (viewportId: string) =>
    Number(cineService.getState().cines?.[viewportId]?.frameRate);
  const viewportStates: SyncStartViewportState[] = getUsCineCapableLayoutViewportIds(
    servicesManager
  )
    .map(viewportId => {
      const { viewport, frameCount } = getFrameInfo(cornerstoneViewportService, viewportId);
      const frameRate = clampFrameRate(
        frameRateOverrides[viewportId] ?? cines?.[viewportId]?.frameRate
      );

      if (!viewport || frameCount <= 1) {
        return null;
      }

      if (hasViewportPaintedFirstImage(viewport)) {
        setViewportFrameIndex(viewport, 0);
      }

      return {
        viewportId,
        stackKey: getViewportStackKey(viewport),
        frameCount,
        frameRate,
        lastLiveFrameRate: readLiveFrameRate(viewportId),
        frameIndex: -1,
        playheadReady: true,
        passStartAt: now,
        inactive: false,
        advanceInFlight: false,
        buffering: false,
        bufferingSince: 0,
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

  const advanceTile = (state: SyncStartViewportState, tickNow: number) => {
    // FPS changed on this tile's bar: keep the current frame, new cadence from here.
    const liveRate = readLiveFrameRate(state.viewportId);

    if (Number.isFinite(liveRate) && liveRate > 0 && liveRate !== state.lastLiveFrameRate) {
      state.lastLiveFrameRate = liveRate;
      state.frameRate = clampFrameRate(liveRate);
      state.passStartAt = tickNow - Math.max(0, state.frameIndex) * (1000 / state.frameRate);
    }

    if (state.advanceInFlight) {
      return;
    }

    const viewport = getAliveViewport(cornerstoneViewportService, state.viewportId);

    if (!viewport) {
      state.inactive = true;
      return;
    }

    // Tile now shows another instance (page change without a driver restart).
    const stackKey = getViewportStackKey(viewport);

    if (stackKey && stackKey !== state.stackKey) {
      state.stackKey = stackKey;
      state.frameCount = Math.max(1, getViewportFrameCount(viewport));
      state.frameIndex = -1;
      state.playheadReady = true;
      state.passStartAt = tickNow;
      state.buffering = false;
      setDrivenPlayhead(state.viewportId, null);
    }

    // Still binding its first image: sit this pass out instead of holding
    // every other loop; it joins at the next layout restart.
    if (
      state.frameCount <= 1 ||
      !hasViewportPaintedFirstImage(viewport, { allowSwapInFlight: true })
    ) {
      state.inactive = true;
      repairUnboundStackViewport(viewport, 0);
      return;
    }

    state.inactive = false;

    const imageIds: string[] = viewport.getImageIds?.() ?? [];
    ensureViewportClipBuffered(state.viewportId, imageIds);

    const periodMs = 1000 / state.frameRate;
    const isPlayableIndex = (index: number) => isCineFramePlayable(imageIds[index]);
    const holdAt = (index: number) => {
      state.passStartAt = tickNow - Math.max(0, index) * periodMs;
    };

    // With waitForFrames, not enough decoded frames ahead (pass start, or ran
    // dry): hold the shown frame and keep the pass clock still until they are.
    const waitForFrames = isCineBufferingEnabled();
    const bufferFrom = state.frameIndex < 0 ? 0 : state.frameIndex + 1;
    if (waitForFrames && (state.frameIndex < 0 || state.buffering)) {
      const required =
        state.frameIndex < 0
          ? getCineStartFrames(state.frameRate, state.frameCount)
          : getCineResumeFrames(state.frameRate, state.frameCount);
      const buffered =
        bufferFrom >= state.frameCount ||
        hasCineBuffer({
          totalFrames: state.frameCount,
          fromIndex: bufferFrom,
          required,
          wrap: false,
          isPlayableIndex,
        });

      if (!buffered) {
        if (!state.buffering) {
          state.buffering = true;
          state.bufferingSince = tickNow;
          countPerf(state.frameIndex < 0 ? 'cineStartWaits' : 'cineUnderruns');
        }
        holdAt(state.frameIndex);
        return;
      }

      if (state.buffering) {
        state.buffering = false;
        recordPerfTiming(
          state.frameIndex < 0 ? 'cineStartBufferMs' : 'cineUnderrunMs',
          tickNow - state.bufferingSince
        );
        holdAt(state.frameIndex);
      }
    }

    const target = Math.min(
      state.frameCount - 1,
      Math.max(0, Math.floor((tickNow - state.passStartAt) / periodMs))
    );
    const ready = isStackFrameReady(imageIds[target]);

    if (
      waitForFrames &&
      !ready &&
      target !== state.frameIndex &&
      !isClipFrameFailed(imageIds[target])
    ) {
      state.buffering = true;
      state.bufferingSince = tickNow;
      countPerf('cineUnderruns');
      holdAt(state.frameIndex);
      return;
    }

    // Evicted after downloading: keep the last picture and hold the pass clock.
    if (!ready && canShowClipFrame(imageIds[target])) {
      holdAt(state.frameIndex);
      state.playheadReady = true;
      setDrivenPlayhead(state.viewportId, {
        index: Math.max(0, state.frameIndex),
        total: state.frameCount,
        ready: true,
      });
      return;
    }

    // Same frame period: nothing to do, unless the empty frame just arrived.
    if (target === state.frameIndex && (state.playheadReady || !ready)) {
      return;
    }

    const needsSwap = ready && getViewportFrameIndex(viewport) !== target;

    // Previous swap still painting: retry next tick rather than cancel it.
    if (needsSwap && !hasViewportPaintedFirstImage(viewport)) {
      return;
    }

    // Not downloaded yet: empty frame until a later pass.
    const showable = ready;
    state.frameIndex = target;
    state.playheadReady = showable;
    setDrivenPlayhead(state.viewportId, {
      index: target,
      total: state.frameCount,
      ready: showable,
    });

    if (!needsSwap) {
      return;
    }

    state.advanceInFlight = true;
    void setViewportFrameIndexAsync(viewport, target, frameOptions(state.viewportId, viewport))
      .catch(() => false)
      .finally(() => {
        state.advanceInFlight = false;
      });
  };

  const isPassFinished = (state: SyncStartViewportState, tickNow: number) =>
    state.inactive ||
    (!state.advanceInFlight &&
      tickNow - state.passStartAt >= state.frameCount * (1000 / state.frameRate));

  registerCineTick(SYNC_START_TICK_ID, () => {
    if (driver?.mode !== 'syncStart' || getCineGeneration() !== clipGeneration) {
      return;
    }

    const tickNow = performance.now();

    viewportStates.forEach(state => advanceTile(state, tickNow));

    if (!viewportStates.every(state => isPassFinished(state, tickNow))) {
      return;
    }

    // Every loop has played its last frame: restart the whole layout at frame 1.
    viewportStates.forEach(state => {
      state.passStartAt = tickNow;
      state.frameIndex = -1;
      state.playheadReady = true;
      state.buffering = false;
    });
  });

  driver = {
    mode: 'syncStart',
    viewportIds: viewportStates.map(state => state.viewportId),
    tickId: SYNC_START_TICK_ID,
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
