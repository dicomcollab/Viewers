import {
  getAliveViewport,
  getViewportFrameIndex,
} from './safeViewportFrameUtils';
import { buildUsBatchNavigationInfo, getUsSeriesPositionInStudy } from './usBatchNavigationUtils';
import { isMultiframeStackDisplaySet } from './cineSyncUtils';

type UsStackCineInfo = {
  viewportId: string;
  currentFrame: number;
  numFrames: number;
  batchSize?: number;
  batchStart?: number;
  batchEnd?: number;
  currentPage?: number;
  totalPages?: number;
  seriesIndex?: number;
  totalSeries?: number;
  hasNextBatch?: boolean;
  hasPrevBatch?: boolean;
};

/** Used when ultrasound has no FrameTime / RecommendedDisplayFrameRate / CineRate. */
const US_CINE_DEFAULT_FPS = 4;
/** Typical CT/MR stack-review cine rate when DICOM provides no recommended FPS. */
const CT_CINE_DEFAULT_FPS = 15;
const MR_CINE_DEFAULT_FPS = 15;
/** Generic multi-slice fallback (XA, OT, etc.) when no DICOM rate is present. */
const STACK_CINE_DEFAULT_FPS = 10;
export const DEFAULT_US_FRAME_STEP = 4;
const US_CINE_MIN_FPS = 1;
const US_CINE_MAX_FPS = 90;

function clampFrame(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function getDefaultCineFrameRateForModality(modality?: string): number {
  const mod = (modality || '').toUpperCase();

  if (mod === 'US') {
    return US_CINE_DEFAULT_FPS;
  }
  if (mod === 'CT') {
    return CT_CINE_DEFAULT_FPS;
  }
  if (mod === 'MR' || mod === 'PT') {
    return MR_CINE_DEFAULT_FPS;
  }

  return STACK_CINE_DEFAULT_FPS;
}

function buildUsStackCineInfo({
  cornerstoneViewportService,
  viewportId,
  displaySetService,
  viewportGridService,
  servicesManager,
}): UsStackCineInfo | null {
  const { viewports } = viewportGridService.getState();
  const { displaySetInstanceUIDs = [] } = viewports.get(viewportId) || {};
  const displaySet = displaySetInstanceUIDs
    .map(uid => displaySetService.getDisplaySetByUID(uid))
    .find(isMultiframeStackDisplaySet);

  if (!displaySet) {
    return null;
  }

  const numFrames = Number(displaySet.numImageFrames) || 0;
  const viewport = getAliveViewport(cornerstoneViewportService, viewportId);
  const currentIndex = getViewportFrameIndex(viewport);

  const batchInfo = servicesManager ? buildUsBatchNavigationInfo(servicesManager) : null;
  const seriesPosition = servicesManager
    ? getUsSeriesPositionInStudy(servicesManager, viewportId)
    : null;

  const isSeriesBatch = batchInfo?.mode === 'instances';

  return {
    viewportId,
    currentFrame: clampFrame(currentIndex + 1, 1, numFrames),
    numFrames: isSeriesBatch ? numFrames : (batchInfo?.totalCount ?? numFrames),
    batchSize: batchInfo?.batchSize,
    batchStart: batchInfo ? batchInfo.batchStart + 1 : undefined,
    batchEnd: batchInfo?.batchEnd,
    currentPage: batchInfo?.currentPage,
    totalPages: batchInfo?.totalPages,
    seriesIndex: seriesPosition?.seriesIndex,
    totalSeries: seriesPosition?.totalSeries,
    hasNextBatch: batchInfo?.hasNextBatch,
    hasPrevBatch: batchInfo?.hasPrevBatch,
  };
}

function clampUsCineFps(value: number): number {
  return Math.max(US_CINE_MIN_FPS, Math.min(US_CINE_MAX_FPS, Math.round(value)));
}

function firstFinitePositive(...values: unknown[]): number | null {
  for (const value of values) {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) {
      return numeric;
    }
  }
  return null;
}

/**
 * Derive FPS from a millisecond interval (FrameTime / ActualFrameDuration).
 * Some sources store FPS directly in those fields instead of milliseconds.
 */
function fpsFromIntervalMs(intervalMs: number): number | null {
  const derivedFps = 1000 / intervalMs;

  if (derivedFps >= US_CINE_MIN_FPS && derivedFps <= US_CINE_MAX_FPS) {
    return clampUsCineFps(derivedFps);
  }

  if (intervalMs >= US_CINE_MIN_FPS && intervalMs <= US_CINE_MAX_FPS) {
    return clampUsCineFps(intervalMs);
  }

  return null;
}

/**
 * Machine cine rate in frames per second.
 * Prefers DICOM RecommendedDisplayFrameRate / CineRate (already FPS),
 * then FrameTime / displaySet.FrameRate (ms), then ActualFrameDuration (ms).
 * When the acquisition does not provide a rate, uses a modality-aware default
 * (US 4, CT/MR 15, other stacks 10).
 */
function getUsCineFrameRate(displaySet, fallbackFps?: number): number {
  const recommendedFps = firstFinitePositive(
    displaySet?.RecommendedDisplayFrameRate,
    displaySet?.CineRate,
    displaySet?.instances?.[0]?.RecommendedDisplayFrameRate,
    displaySet?.instances?.[0]?.CineRate
  );

  if (recommendedFps != null) {
    return clampUsCineFps(recommendedFps);
  }

  const frameTimeMs = firstFinitePositive(
    displaySet?.FrameTime,
    displaySet?.FrameRate,
    displaySet?.instances?.[0]?.FrameTime
  );

  if (frameTimeMs != null) {
    const fromFrameTime = fpsFromIntervalMs(frameTimeMs);
    if (fromFrameTime != null) {
      return fromFrameTime;
    }
  }

  const actualFrameDurationMs = firstFinitePositive(
    displaySet?.ActualFrameDuration,
    displaySet?.instances?.[0]?.ActualFrameDuration
  );

  if (actualFrameDurationMs != null) {
    const fromActualDuration = fpsFromIntervalMs(actualFrameDurationMs);
    if (fromActualDuration != null) {
      return fromActualDuration;
    }
  }

  const modalityDefault = getDefaultCineFrameRateForModality(displaySet?.Modality);
  return clampUsCineFps(fallbackFps ?? modalityDefault);
}

export {
  buildUsStackCineInfo,
  getDefaultCineFrameRateForModality,
  getUsCineFrameRate,
  CT_CINE_DEFAULT_FPS,
  US_CINE_DEFAULT_FPS,
};
export type { UsStackCineInfo };
