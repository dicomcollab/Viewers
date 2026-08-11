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

/** Used when the acquisition has no FrameTime / RecommendedDisplayFrameRate / CineRate. */
const US_CINE_DEFAULT_FPS = 4;
export const DEFAULT_US_FRAME_STEP = 4;
const US_CINE_MIN_FPS = 1;
const US_CINE_MAX_FPS = 90;

function clampFrame(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)));
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
  const viewport = cornerstoneViewportService.getCornerstoneViewport(viewportId);
  const currentIndex = viewport?.getCurrentImageIdIndex?.() ?? 0;

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
 * Machine cine rate in frames per second.
 * Prefers DICOM RecommendedDisplayFrameRate / CineRate (already FPS),
 * then FrameTime / displaySet.FrameRate (milliseconds between frames).
 * Falls back to 4 FPS when the acquisition does not provide a rate.
 */
function getUsCineFrameRate(displaySet, fallbackFps = US_CINE_DEFAULT_FPS): number {
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
    const derivedFps = 1000 / frameTimeMs;

    if (derivedFps >= US_CINE_MIN_FPS && derivedFps <= US_CINE_MAX_FPS) {
      return clampUsCineFps(derivedFps);
    }

    // Some sources store FPS in the FrameTime/FrameRate field instead of milliseconds.
    if (frameTimeMs >= US_CINE_MIN_FPS && frameTimeMs <= US_CINE_MAX_FPS) {
      return clampUsCineFps(frameTimeMs);
    }
  }

  return clampUsCineFps(fallbackFps);
}

export { buildUsStackCineInfo, getUsCineFrameRate, US_CINE_DEFAULT_FPS };
export type { UsStackCineInfo };
