import { buildUsBatchNavigationInfo } from './usBatchNavigationUtils';

type UsStackCineInfo = {
  viewportId: string;
  currentFrame: number;
  numFrames: number;
  batchSize?: number;
  batchStart?: number;
  batchEnd?: number;
  hasNextBatch?: boolean;
  hasPrevBatch?: boolean;
};

const US_CINE_DEFAULT_FPS = 15;
export const DEFAULT_US_FRAME_STEP = 4;

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
    .find(ds => ds?.Modality === 'US' && (ds?.numImageFrames ?? 0) > 1);

  if (!displaySet) {
    return null;
  }

  const numFrames = Number(displaySet.numImageFrames) || 0;
  const viewport = cornerstoneViewportService.getCornerstoneViewport(viewportId);
  const currentIndex = viewport?.getCurrentImageIdIndex?.() ?? 0;

  const batchInfo = servicesManager ? buildUsBatchNavigationInfo(servicesManager) : null;

  return {
    viewportId,
    currentFrame: clampFrame(currentIndex + 1, 1, numFrames),
    numFrames: batchInfo?.totalCount ?? numFrames,
    batchSize: batchInfo?.batchSize,
    batchStart: batchInfo ? batchInfo.batchStart + 1 : undefined,
    batchEnd: batchInfo?.batchEnd,
    hasNextBatch: batchInfo?.hasNextBatch,
    hasPrevBatch: batchInfo?.hasPrevBatch,
  };
}

function getUsCineFrameRate(displaySet, fallbackFps = US_CINE_DEFAULT_FPS): number {
  const frameTimeMs = Number(displaySet?.FrameRate);

  if (Number.isFinite(frameTimeMs) && frameTimeMs > 0) {
    const derivedFps = Math.round(1000 / frameTimeMs);

    if (derivedFps >= 5 && derivedFps <= 90) {
      return derivedFps;
    }
  }

  return fallbackFps;
}

export { buildUsStackCineInfo, getUsCineFrameRate, US_CINE_DEFAULT_FPS };
export type { UsStackCineInfo };
