import { getEnabledElement, Enums, eventTarget, EVENTS } from '@cornerstonejs/core';
import { utilities } from '@cornerstonejs/tools';
import { getSyncedViewports } from './utils/cineSyncUtils';
import { validateSyncPlaybackDriver } from './utils/usCineSyncPlaybackDriver';
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
import { shouldSuppressCineAutoplay } from './utils/cineAutoplaySuppress';
import {
  isStackFrameReady,
  prefetchStackFrame,
  prefetchUpcomingStackFrames,
  getPrefetchCount,
} from './utils/cineFrameLoadUtils';
import { setCineWaitingForFrame } from './utils/cineFrameWaitStore';

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

function cleanupLiveClip(viewportId?: string): void {
  if (!viewportId) {
    return;
  }

  liveClipCleanups.get(viewportId)?.();
  liveClipCleanups.delete(viewportId);
  setCineWaitingForFrame(viewportId, null);
}

function getLiveStackViewport(
  servicesManager: AppTypes.ServicesManager,
  element: HTMLElement,
  viewportId?: string
) {
  if (viewportId) {
    const byId = getAliveViewport(
      servicesManager.services.cornerstoneViewportService,
      viewportId
    );

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
  };

  element.addEventListener(EVENTS.STACK_VIEWPORT_SCROLL, onExternalFrameChange);

  if (viewportId) {
    liveClipCleanups.set(viewportId, () => {
      cancelled = true;
      eventTarget.removeEventListener(EVENTS.IMAGE_LOADED, onImageLoaded);
      element.removeEventListener(EVENTS.STACK_VIEWPORT_SCROLL, onExternalFrameChange);
      setCineWaitingForFrame(viewportId, null);
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
      typeof liveViewport.getImageIds === 'function' ? liveViewport.getImageIds() ?? [] : [];
    const liveCount = imageIds.length;

    if (liveCount <= 1) {
      nextFrameAt = now + periodMs;
      prefetchUpcomingStackFrames(imageIds, 0, getPrefetchCount(periodMs));
      return;
    }

    const viewportStatus = liveViewport.viewportStatus;
    if (
      !hasPaintedOnce &&
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

  const { viewportGridService } = servicesManager.services;
  let ensureTimer: ReturnType<typeof setTimeout> | null = null;
  let ensureAttempts = 0;

  viewportGridService.subscribe(viewportGridService.EVENTS.GRID_STATE_CHANGED, () => {
    validateSyncPlaybackDriver(servicesManager);

    if (ensureTimer) {
      window.clearTimeout(ensureTimer);
    }

    ensureAttempts = 0;
    const run = () => {
      if (shouldSuppressCineAutoplay()) {
        ensureAttempts += 1;
        if (ensureAttempts < 16) {
          ensureTimer = window.setTimeout(run, 200);
        }
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
