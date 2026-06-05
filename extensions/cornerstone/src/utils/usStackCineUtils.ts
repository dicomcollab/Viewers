type UsStackCineInfo = {
  viewportId: string;
  currentFrame: number;
  numFrames: number;
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

  return {
    viewportId,
    currentFrame: clampFrame(currentIndex + 1, 1, numFrames),
    numFrames,
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
