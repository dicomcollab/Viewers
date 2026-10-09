import { getEnabledElement, Enums, eventTarget, EVENTS } from '@cornerstonejs/core';
import { utilities } from '@cornerstonejs/tools';
import { getSyncedViewports } from './utils/cineSyncUtils';
import {
  isCinePlaybackManaged,
  validateSyncPlaybackDriver,
} from './utils/usCineSyncPlaybackDriver';
import {
  canShowClipFrame,
  ensureViewportClipBuffered,
  isUsClipViewport,
} from './utils/usClipBufferStore';
import { ensureLayoutCinePlayback } from './utils/usCinePlaybackUtils';
import {
  getAliveViewport,
  getViewportFrameIndex,
  getViewportStackKey,
  isViewportAlive,
  setViewportFrameIndexAsync,
} from './utils/safeViewportFrameUtils';
import { cineDebug, cineDebugError, cineDebugWarn } from './utils/cineDebug';
import {
  clearCustomClip,
  clearCustomClipByViewportId,
  getCineGeneration,
  setCustomClip,
} from './utils/cineClipStateUtils';
import {
  getCineAutoplaySuppressRemainingMs,
  shouldSuppressCineAutoplay,
} from './utils/cineAutoplaySuppress';
import {
  isStackFrameReady,
  prefetchStackFrame,
  prefetchUpcomingStackFrames,
  getPrefetchCount,
} from './utils/cineFrameLoadUtils';
import { setCineWaitingForFrame } from './utils/cineFrameWaitStore';
import { isAwaitingFirstImage } from './utils/viewportFirstImageStore';
import { getCinePlayhead, setCinePlayhead } from './utils/cinePlayheadStore';
import { syncUsViewportGridToReviewOrder } from './utils/usBatchNavigationUtils';

export const DEFAULT_FRAME_STEP = 4;
export const STEP_INTERVAL_MS = 400;
/** Tick fast enough to hit 90 FPS (~11ms) without relying on display refresh alone. */
const LIVE_CLIP_TICK_MS = 8;
const FPS_MAX = 90;
const liveClipCleanups = new Map<string, () => void>();

function getEventImageId(evt: Event): string | undefined {
  const detail = (evt as CustomEvent)?.detail;
  return detail?.image?.imageId ?? detail?.imageId;
}

/**
 * Drop a tile's timeline when its own clip stops. A sync driver publishes the
 * timeline of the tiles it drives; stopping the (unused) native clip of such a
 * tile must not wipe it, or the counters fall back to the last painted frame.
 */
function releaseClipPlayhead(viewportId?: string): void {
  if (viewportId && !isCinePlaybackManaged(viewportId)) {
    setCinePlayhead(viewportId, null);
  }
}

function cleanupLiveClip(viewportId?: string): void {
  if (!viewportId) {
    return;
  }

  liveClipCleanups.get(viewportId)?.();
  liveClipCleanups.delete(viewportId);
  setCineWaitingForFrame(viewportId, null);
  releaseClipPlayhead(viewportId);
}

function getLiveStackViewport(
  servicesManager: AppTypes.ServicesManager,
  element: HTMLElement,
  viewportId?: string
) {
  if (viewportId) {
    const byId = getAliveViewport(servicesManager.services.cornerstoneViewportService, viewportId);

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
    Math.min(
      FPS_MAX,
      Number.isFinite(fpsFromState) && fpsFromState > 0 ? fpsFromState : fallbackFps
    )
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
  const fallbackFps = Math.max(1, Math.min(FPS_MAX, Number(options.framesPerSecond) || 1));
  const frameStep = Math.max(
    1,
    Math.round(options.cinePlayMode === 'step' ? (options.frameStep ?? DEFAULT_FRAME_STEP) : 1)
  );

  clearCustomClipByViewportId(viewportId);
  clearCustomClip(element);
  setCineWaitingForFrame(viewportId, null);

  const clipGeneration = getCineGeneration();
  const { cornerstoneViewportService } = servicesManager.services;
  let boundStackKey: string | null = null;
  let cancelled = false;
  let nextFrameAt = performance.now();
  let lastPeriodMs = getLiveClipPeriodMs(
    servicesManager,
    viewportId,
    options.cinePlayMode,
    fallbackFps
  );
  let hasPaintedOnce = false;
  let waitingImageId: string | null = null;
  let advanceInFlight = false;
  let expectedAdvanceIndex: number | null = null;
  let isUsClip: boolean | null = null;

  // US timeline: the playhead walks frames 1..N at the clip FPS whether or not
  // each frame has downloaded. Position comes from elapsed time (not from when
  // the previous swap finished), so the loop keeps an exact cadence.
  let timelineBase = -1;
  let timelineStartAt = 0;
  let timelinePeriodMs = 0;
  let playheadIndex = -1;
  let playheadReady = true;

  const rebaseTimeline = (index: number, periodMs: number, startAt: number) => {
    timelineBase = index;
    timelineStartAt = startAt;
    timelinePeriodMs = periodMs;
    playheadIndex = index;
  };

  const advanceUsTimeline = (
    liveViewport,
    imageIds: string[],
    currentIndex: number,
    periodMs: number,
    now: number
  ) => {
    const total = imageIds.length;

    if (timelineBase < 0 || playheadIndex >= total) {
      rebaseTimeline(currentIndex, periodMs, now);
      playheadReady = true;
      setCinePlayhead(viewportId, { index: currentIndex, total, ready: true });
      return;
    }

    if (periodMs !== timelinePeriodMs) {
      rebaseTimeline(playheadIndex, periodMs, now);
    }

    const steps = Math.floor((now - timelineStartAt) / timelinePeriodMs);
    const target = (timelineBase + steps * frameStep) % total;
    const ready = isStackFrameReady(imageIds[target]);
    // Evicted after downloading: keep the last picture while it reloads.
    const showable = ready || canShowClipFrame(imageIds[target]);

    // Same frame period: nothing to do, unless the empty frame just arrived.
    if (target === playheadIndex && (playheadReady || !ready)) {
      return;
    }

    if (target !== playheadIndex) {
      timelineStartAt += steps * timelinePeriodMs;
      timelineBase = target;
      playheadIndex = target;
    }

    playheadReady = showable;
    setCinePlayhead(viewportId, { index: target, total, ready: showable });

    if (!ready || target === currentIndex) {
      return;
    }

    expectedAdvanceIndex = target;
    advanceInFlight = true;
    const hangWatch = window.setTimeout(
      () => {
        advanceInFlight = false;
      },
      Math.max(400, timelinePeriodMs * 3)
    );

    void setViewportFrameIndexAsync(liveViewport, target, {
      viewportId,
      cornerstoneViewportService,
      generation: clipGeneration,
      getGeneration: getCineGeneration,
      isCurrent: () => !cancelled && getCineGeneration() === clipGeneration,
      stackKey: boundStackKey,
    })
      .catch(() => false)
      .finally(() => {
        window.clearTimeout(hangWatch);
        advanceInFlight = false;
      });
  };

  const scheduleNextFrame = (fromDeadline: number, periodMs: number) => {
    const due = fromDeadline + periodMs;
    const nowAfter = performance.now();
    // Stay on cadence when the swap was fast; if more than one period late,
    // resync to now so we do not burst-skip unpainted frames.
    nextFrameAt = due < nowAfter - periodMs ? nowAfter : Math.max(due, nowAfter);
  };

  const onImageLoaded = (evt: Event) => {
    const loadedId = getEventImageId(evt);

    if (!loadedId || loadedId !== waitingImageId) {
      return;
    }

    nextFrameAt = Math.min(nextFrameAt, performance.now());
  };

  const stopClipAndUnbind = (playElement: HTMLElement) => {
    cancelled = true;
    eventTarget.removeEventListener(EVENTS.IMAGE_LOADED, onImageLoaded);
    element.removeEventListener(EVENTS.STACK_VIEWPORT_SCROLL, onExternalFrameChange);
    playElement.removeEventListener(EVENTS.STACK_VIEWPORT_SCROLL, onExternalFrameChange);
    setCineWaitingForFrame(viewportId, null);
    releaseClipPlayhead(viewportId);
    clearCustomClipByViewportId(viewportId);
    clearCustomClip(playElement);
    clearCustomClip(element);
  };

  eventTarget.addEventListener(EVENTS.IMAGE_LOADED, onImageLoaded);
  cleanupLiveClip(viewportId);

  const onExternalFrameChange = (evt: Event) => {
    const detail = (evt as CustomEvent)?.detail;
    const newIndex = detail?.newImageIdIndex ?? detail?.imageIdIndex;
    const liveViewport = getLiveStackViewport(servicesManager, element, viewportId);
    const currentIndex = Number.isFinite(newIndex)
      ? Number(newIndex)
      : getViewportFrameIndex(liveViewport);

    if (expectedAdvanceIndex != null && currentIndex === expectedAdvanceIndex) {
      expectedAdvanceIndex = null;
      return;
    }

    expectedAdvanceIndex = null;
    waitingImageId = null;
    setCineWaitingForFrame(viewportId, null);
    advanceInFlight = false;
    nextFrameAt = performance.now() + lastPeriodMs;

    // User scrubbed during playback: the timeline continues from that frame.
    if (timelineBase >= 0) {
      rebaseTimeline(currentIndex, timelinePeriodMs || lastPeriodMs, performance.now());
      playheadReady = true;
      const total = getCinePlayhead(viewportId)?.total;
      if (total) {
        setCinePlayhead(viewportId, { index: currentIndex, total, ready: true });
      }
    }
  };

  element.addEventListener(EVENTS.STACK_VIEWPORT_SCROLL, onExternalFrameChange);

  if (viewportId) {
    liveClipCleanups.set(viewportId, () => {
      cancelled = true;
      eventTarget.removeEventListener(EVENTS.IMAGE_LOADED, onImageLoaded);
      element.removeEventListener(EVENTS.STACK_VIEWPORT_SCROLL, onExternalFrameChange);
      setCineWaitingForFrame(viewportId, null);
      releaseClipPlayhead(viewportId);
    });
  }

  const intervalId = window.setInterval(() => {
    if (advanceInFlight) {
      return;
    }

    if (cancelled || getCineGeneration() !== clipGeneration) {
      stopClipAndUnbind(element);
      return;
    }

    const liveViewport = getLiveStackViewport(servicesManager, element, viewportId);

    if (!liveViewport) {
      stopClipAndUnbind(element);
      return;
    }

    const stackKey = getViewportStackKey(liveViewport);

    if (!boundStackKey) {
      boundStackKey = stackKey;
    } else if (stackKey && stackKey !== boundStackKey) {
      // Next/previous reused this viewportId with a different SOP.
      stopClipAndUnbind(element);
      return;
    }

    const periodMs = getLiveClipPeriodMs(
      servicesManager,
      viewportId,
      options.cinePlayMode,
      fallbackFps
    );

    if (periodMs !== lastPeriodMs) {
      nextFrameAt = Math.min(nextFrameAt, performance.now());
      lastPeriodMs = periodMs;
    }

    const now = performance.now();
    const imageIds =
      typeof liveViewport.getImageIds === 'function' ? (liveViewport.getImageIds() ?? []) : [];
    const liveCount = imageIds.length;

    if (liveCount <= 1) {
      nextFrameAt = now + periodMs;
      prefetchUpcomingStackFrames(imageIds, 0, getPrefetchCount(periodMs));
      return;
    }

    if (viewportId && isUsClip == null) {
      isUsClip = isUsClipViewport(servicesManager, viewportId);
    }

    // Keeps the in-order clip download attached to this tile (frame 1 first).
    if (viewportId && isUsClip) {
      ensureViewportClipBuffered(viewportId, imageIds);
    }

    // Bind still loading its first frame: a swap now would cancel it (black tile).
    if (isAwaitingFirstImage(viewportId)) {
      nextFrameAt = now + periodMs;
      return;
    }

    const viewportStatus = liveViewport.viewportStatus;
    // A bind whose first frame failed to download has no image and never reaches
    // RENDERED; let the timeline paint frames as the clip download delivers them.
    const bindFrameFailed = !liveViewport.csImage && isUsClip === true;
    if (
      !hasPaintedOnce &&
      !bindFrameFailed &&
      viewportStatus != null &&
      Enums.ViewportStatus?.RENDERED != null &&
      viewportStatus !== Enums.ViewportStatus.RENDERED
    ) {
      nextFrameAt = now + periodMs;
      return;
    }

    if (viewportStatus === Enums.ViewportStatus.RENDERED) {
      hasPaintedOnce = true;
    }

    let index = 0;

    try {
      index =
        typeof liveViewport.getCurrentImageIdIndex === 'function'
          ? liveViewport.getCurrentImageIdIndex()
          : 0;
    } catch {
      stopClipAndUnbind(element);
      return;
    }

    if (isUsClip) {
      advanceUsTimeline(liveViewport, imageIds, index, periodMs, now);
      return;
    }

    prefetchUpcomingStackFrames(imageIds, index, getPrefetchCount(periodMs));

    if (now < nextFrameAt) {
      return;
    }

    const dueAt = nextFrameAt;
    const nextIndex = (index + frameStep) % liveCount;

    expectedAdvanceIndex = nextIndex;
    const nextImageId = imageIds[nextIndex];

    if (!isStackFrameReady(nextImageId)) {
      waitingImageId = nextImageId;
      prefetchStackFrame(nextImageId);
      setCineWaitingForFrame(viewportId, {
        imageIndex: nextIndex,
        imageId: nextImageId,
      });
      // Stay on the current frame until this imageId has decoded pixels.
      nextFrameAt = now + Math.min(periodMs, 50);
      return;
    }

    waitingImageId = null;
    setCineWaitingForFrame(viewportId, null);

    if (nextIndex === index) {
      scheduleNextFrame(dueAt, periodMs);
      return;
    }

    // Await the stack swap so wadouri/wadors/JPEG cannot queue another
    // setImageIdIndex that cancels the in-flight paint (bar runs, first frame stuck).
    advanceInFlight = true;
    const advanceTimeoutMs = Math.max(400, lastPeriodMs * 3);
    const hangWatch = window.setTimeout(() => {
      advanceInFlight = false;
    }, advanceTimeoutMs);

    void setViewportFrameIndexAsync(liveViewport, nextIndex, {
      viewportId,
      cornerstoneViewportService,
      generation: clipGeneration,
      getGeneration: getCineGeneration,
      isCurrent: () => !cancelled && getCineGeneration() === clipGeneration,
      stackKey: boundStackKey,
    })
      .then(ok => {
        if (ok && getCineGeneration() === clipGeneration) {
          hasPaintedOnce = true;
        }
        scheduleNextFrame(dueAt, lastPeriodMs);
      })
      .catch(() => {
        scheduleNextFrame(dueAt, lastPeriodMs);
      })
      .finally(() => {
        window.clearTimeout(hangWatch);
        advanceInFlight = false;
      });
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
      cleanupLiveClip(viewportId);
      clearCustomClipByViewportId(viewportId);
      clearCustomClip(playElement);
      clearCustomClip(element);

      // A sync driver already advances this tile; a second clip would fight it
      // (e.g. FPS change during sync start restarting a native clip).
      if (viewportId && isCinePlaybackManaged(viewportId)) {
        cineDebug('initCineService', 'playClip skipped — driven by sync driver', { viewportId });
        return;
      }

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

      cleanupLiveClip(viewportId);
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

  const { viewportGridService, hangingProtocolService } = servicesManager.services;
  let ensureTimer: ReturnType<typeof setTimeout> | null = null;
  let ensureAttempts = 0;
  let reviewOrderSyncTimer: ReturnType<typeof setTimeout> | null = null;

  const scheduleUsReviewOrderSync = () => {
    if (reviewOrderSyncTimer) {
      window.clearTimeout(reviewOrderSyncTimer);
    }

    // Wait for ViewportGrid to apply PROTOCOL_CHANGED → setLayout first.
    reviewOrderSyncTimer = window.setTimeout(() => {
      reviewOrderSyncTimer = null;
      syncUsViewportGridToReviewOrder(servicesManager);
    }, 80);
  };

  hangingProtocolService?.subscribe?.(
    hangingProtocolService.EVENTS.PROTOCOL_CHANGED,
    scheduleUsReviewOrderSync
  );

  viewportGridService.subscribe(viewportGridService.EVENTS.GRID_STATE_CHANGED, () => {
    validateSyncPlaybackDriver(servicesManager);

    if (ensureTimer) {
      window.clearTimeout(ensureTimer);
    }

    ensureAttempts = 0;
    const run = () => {
      // Paging suppression is time-bounded; wait it out rather than spending
      // retries, or a slow page change ends with tiles that never autoplay.
      if (shouldSuppressCineAutoplay()) {
        ensureTimer = window.setTimeout(run, getCineAutoplaySuppressRemainingMs() + 50);
        return;
      }

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
