/**
 * Ultrasound cine buffering, only with appConfig.cineBuffer.waitForFrames.
 *
 * Off (default): the playhead keeps its cadence; a frame not downloaded yet is
 * shown empty and appears on a later pass of the loop.
 *
 * On: cine moves only over frames decoded and resident in the image cache.
 * Playback starts once `startFrames` consecutive frames from the current one
 * are playable, holds on the frame it shows when the next one is missing
 * (buffering) and resumes once `resumeFrames` are playable again. The clock
 * restarts after a hold, so frames are never skipped to catch up.
 */
let waitForFrames = false;

function isCineBufferingEnabled(): boolean {
  return waitForFrames;
}

type CineBufferConfig = {
  /** Seconds of playback that must be decoded before the first frame moves. */
  startSeconds: number;
  minStartFrames: number;
  maxStartFrames: number;
  /** Share of the start buffer needed to resume after running dry. */
  resumeFraction: number;
};

const DEFAULT_CONFIG: CineBufferConfig = {
  startSeconds: 0.75,
  minStartFrames: 8,
  maxStartFrames: 30,
  resumeFraction: 0.5,
};

let config: CineBufferConfig = { ...DEFAULT_CONFIG };

function configureCineBufferPolicy(
  overrides?: (Partial<CineBufferConfig> & { waitForFrames?: boolean }) | null
): void {
  waitForFrames = overrides?.waitForFrames === true;
  const next = { ...DEFAULT_CONFIG };
  Object.keys(DEFAULT_CONFIG).forEach(key => {
    const value = Number(overrides?.[key]);
    if (Number.isFinite(value) && value > 0) {
      next[key] = value;
    }
  });
  next.maxStartFrames = Math.max(next.minStartFrames, next.maxStartFrames);
  next.resumeFraction = Math.min(1, next.resumeFraction);
  config = next;
}

/** Distinct frames one pass visits with this stride. */
function getLoopPositions(totalFrames: number, frameStep: number): number {
  return Math.max(1, Math.ceil(Math.max(1, totalFrames) / Math.max(1, frameStep)));
}

/** Frames (along the stride) to have ready before playback starts. */
function getCineStartFrames(stepsPerSecond: number, totalFrames: number, frameStep = 1): number {
  const rate = Number.isFinite(stepsPerSecond) && stepsPerSecond > 0 ? stepsPerSecond : 1;
  const wanted = Math.ceil(rate * config.startSeconds);
  const clamped = Math.max(config.minStartFrames, Math.min(config.maxStartFrames, wanted));
  return Math.min(clamped, getLoopPositions(totalFrames, frameStep));
}

function getCineResumeFrames(stepsPerSecond: number, totalFrames: number, frameStep = 1): number {
  return Math.max(
    1,
    Math.ceil(getCineStartFrames(stepsPerSecond, totalFrames, frameStep) * config.resumeFraction)
  );
}

type BufferQuery = {
  totalFrames: number;
  fromIndex: number;
  frameStep?: number;
  required: number;
  /** Loop past the last frame (cine loop). Without it, frames up to the end suffice. */
  wrap?: boolean;
  isPlayableIndex: (index: number) => boolean;
};

/**
 * Consecutive playable frames from `fromIndex` (inclusive) along the stride,
 * and how many are needed (fewer near the end of a non-wrapping pass).
 */
function measureCineBuffer({
  totalFrames,
  fromIndex,
  frameStep = 1,
  required,
  wrap = true,
  isPlayableIndex,
}: BufferQuery): { ready: number; needed: number; firstMissing: number } {
  const total = Math.max(1, totalFrames);
  const step = Math.max(1, Math.round(frameStep));
  const start = ((Math.round(fromIndex) % total) + total) % total;
  const available = wrap
    ? getLoopPositions(total, step)
    : Math.max(1, Math.floor((total - 1 - start) / step) + 1);
  const needed = Math.max(0, Math.min(Math.round(required), available));

  let ready = 0;
  let index = start;
  while (ready < needed) {
    if (!isPlayableIndex(index)) {
      return { ready, needed, firstMissing: index };
    }
    ready += 1;
    index = (index + step) % total;
  }

  return { ready, needed, firstMissing: -1 };
}

function hasCineBuffer(query: BufferQuery): boolean {
  const { ready, needed } = measureCineBuffer(query);
  return ready >= needed;
}

export {
  configureCineBufferPolicy,
  getCineResumeFrames,
  getCineStartFrames,
  hasCineBuffer,
  isCineBufferingEnabled,
  measureCineBuffer,
};
export type { CineBufferConfig };
