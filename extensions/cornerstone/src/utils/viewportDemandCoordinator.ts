import { imageLoadPoolManager } from '@cornerstonejs/core';
import { forgetQueuedStackFrames } from './cineFrameLoadUtils';
import { getAwaitingFirstImageCount, subscribeFirstImageWait } from './viewportFirstImageStore';
import { countPerf, recordPerfTiming } from './viewerPerfMetrics';

/**
 * Visible images first. While any viewport waits for its first image (page
 * change, layout change, study open) background work holds back:
 * - the study prefetcher sends no new requests,
 * - ultrasound clip buffers request one frame per clip (see usClipBufferStore),
 * so the frames about to be shown get the connections and decoders. The phase
 * ends once every viewport has painted, or after `maxPhaseMs` so a tile that
 * never loads cannot hold background work back for good.
 *
 * Requests already sent are not aborted: one download can serve several
 * viewports and frames (a whole DICOM file), and the pool and clip buffer
 * already bound how many are running.
 */
const PAUSE_REASON = 'initialFrames';
/** Tiles of one page start binding a few ms apart; do not end the phase in between. */
const END_SETTLE_MS = 120;
const DEFAULT_MAX_PHASE_MS = 6000;
/** A navigation whose binds start later than this is not what the phase measured. */
const NAVIGATION_MATCH_MS = 2000;

type Prefetcher = { setPaused?: (paused: boolean, reason?: string) => void };
type PhaseListener = (active: boolean) => void;

let maxPhaseMs = DEFAULT_MAX_PHASE_MS;
let generation = 0;
let phaseActive = false;
let capped = false;
let phaseStartedAt = 0;
let navigationStartedAt: number | null = null;
let capTimer: ReturnType<typeof setTimeout> | null = null;
let settleTimer: ReturnType<typeof setTimeout> | null = null;
let prefetcher: Prefetcher | null = null;
let unsubscribeFirstImageWait: (() => void) | null = null;
const listeners = new Set<PhaseListener>();

function notify(active: boolean): void {
  listeners.forEach(listener => {
    try {
      listener(active);
    } catch (error) {
      console.warn('[viewportDemandCoordinator] listener failed', error);
    }
  });
}

function setPrefetchPaused(paused: boolean): void {
  try {
    prefetcher?.setPaused?.(paused, PAUSE_REASON);
  } catch {
    // Prefetcher not registered in this mode.
  }
}

function clearTimers(): void {
  if (capTimer) {
    clearTimeout(capTimer);
    capTimer = null;
  }
  if (settleTimer) {
    clearTimeout(settleTimer);
    settleTimer = null;
  }
}

function startPhase(): void {
  phaseActive = true;
  capped = false;
  phaseStartedAt = performance.now();
  setPrefetchPaused(true);
  capTimer = setTimeout(() => {
    capTimer = null;
    capped = true;
    countPerf('initialFramesPhaseCapped');
    setPrefetchPaused(false);
    notify(false);
  }, maxPhaseMs);
  notify(true);
}

function endPhase(): void {
  const now = performance.now();
  const wasCapped = capped;

  clearTimers();
  phaseActive = false;
  capped = false;
  recordPerfTiming('firstImagesMs', now - phaseStartedAt);

  if (
    navigationStartedAt != null &&
    phaseStartedAt >= navigationStartedAt &&
    phaseStartedAt - navigationStartedAt <= NAVIGATION_MATCH_MS
  ) {
    recordPerfTiming('navigationToImagesMs', now - navigationStartedAt);
  }
  navigationStartedAt = null;

  setPrefetchPaused(false);
  if (!wasCapped) {
    notify(false);
  }
}

function onFirstImageWaitChanged(): void {
  if (getAwaitingFirstImageCount() > 0) {
    if (settleTimer) {
      clearTimeout(settleTimer);
      settleTimer = null;
    }
    if (!phaseActive) {
      startPhase();
    }
    return;
  }

  if (phaseActive && !settleTimer) {
    settleTimer = setTimeout(() => {
      settleTimer = null;
      if (getAwaitingFirstImageCount() === 0) {
        endPhase();
      }
    }, END_SETTLE_MS);
  }
}

/** True while visible viewports are still waiting for their first image. */
function isInitialFramesPhase(): boolean {
  return phaseActive && !capped;
}

function subscribeInitialFramesPhase(listener: PhaseListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Changes on every next/previous page; work started under an older value is stale. */
function getNavigationGeneration(): number {
  return generation;
}

/**
 * Cine look-ahead requests still queued for the old page: drop them (never
 * sent, so nothing in flight is lost). Returns how many were dropped.
 */
function dropQueuedCineLookahead(): number {
  const dropped: string[] = [];

  try {
    imageLoadPoolManager.filterRequests(request => {
      const details = request?.additionalDetails as
        | { cineFramePrefetch?: boolean; imageId?: string }
        | undefined;
      if (details?.cineFramePrefetch) {
        if (details.imageId) {
          dropped.push(details.imageId);
        }
        return false;
      }
      return true;
    });
  } catch {
    return 0;
  }

  forgetQueuedStackFrames(dropped);
  return dropped.length;
}

/** Next/previous page: invalidate the old page's queued work. */
function beginViewportNavigation(): number {
  generation += 1;
  navigationStartedAt = performance.now();
  countPerf('navigations');
  countPerf('droppedQueuedRequests', dropQueuedCineLookahead());
  return generation;
}

function initViewportDemandCoordinator(
  servicesManager: AppTypes.ServicesManager,
  { maxInitialPhaseMs }: { maxInitialPhaseMs?: number } = {}
): void {
  prefetcher = (servicesManager?.services?.studyPrefetcherService as Prefetcher) ?? null;
  maxPhaseMs = Number(maxInitialPhaseMs) > 0 ? Number(maxInitialPhaseMs) : DEFAULT_MAX_PHASE_MS;
  unsubscribeFirstImageWait?.();
  unsubscribeFirstImageWait = subscribeFirstImageWait(onFirstImageWaitChanged);
  onFirstImageWaitChanged();
}

/** Test / mode-exit reset. */
function resetViewportDemandCoordinator(): void {
  clearTimers();
  if (phaseActive) {
    setPrefetchPaused(false);
  }
  phaseActive = false;
  capped = false;
  navigationStartedAt = null;
  unsubscribeFirstImageWait?.();
  unsubscribeFirstImageWait = null;
  prefetcher = null;
  listeners.clear();
}

export {
  beginViewportNavigation,
  getNavigationGeneration,
  initViewportDemandCoordinator,
  isInitialFramesPhase,
  resetViewportDemandCoordinator,
  subscribeInitialFramesPhase,
};
