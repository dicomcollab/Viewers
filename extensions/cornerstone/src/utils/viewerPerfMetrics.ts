/**
 * Cheap counters and timings for image loading and cine playback. Holds no
 * image ids, URLs or patient data.
 *
 * Console (after loading a 2×2 echo study on original DICOM):
 *   window.__ohifPerf.reset()
 *   // play / page for ~30s
 *   window.__ohifPerf.snapshot()
 *   ohifTileDiagnostics()   // only if localStorage ohifTileDiagnostics=on
 *
 * What to check after Phase 1 perf work:
 *   - live.clipBuffer.inFlight stays low once clips show downloaded=100%
 *   - live.studyPrefetcher.paused includes "visibleClips" only while layout first-pass downloads
 *   - live.studyPrefetcher.smoothPlaybackMode true while cine plays (prefetch capped at 1)
 *   - study panel progress does not jump backward after reaching 100%
 *   - counters.cineUnderruns / cineStartWaits do not climb without bound
 *
 * Memory figures are the decoded-image cache only, not the whole tab (GPU
 * textures, compressed DICOM files and the JS heap are not included).
 */
type Timing = { count: number; last: number; total: number; max: number };

const counters = new Map<string, number>();
const timings = new Map<string, Timing>();
const snapshotProviders = new Map<string, () => unknown>();

function countPerf(name: string, by = 1): void {
  if (!(by > 0)) {
    return;
  }
  counters.set(name, (counters.get(name) ?? 0) + by);
}

function recordPerfTiming(name: string, ms: number): void {
  if (!Number.isFinite(ms) || ms < 0) {
    return;
  }
  const timing = timings.get(name) ?? { count: 0, last: 0, total: 0, max: 0 };
  timing.count += 1;
  timing.last = ms;
  timing.total += ms;
  timing.max = Math.max(timing.max, ms);
  timings.set(name, timing);
}

/** Extra live state (queue depths, cache size) merged into every snapshot. */
function registerPerfSnapshotProvider(name: string, provider: () => unknown): void {
  snapshotProviders.set(name, provider);
}

function getPerfSnapshot() {
  const timingSummary: Record<
    string,
    { count: number; lastMs: number; avgMs: number; maxMs: number }
  > = {};
  timings.forEach((timing, name) => {
    timingSummary[name] = {
      count: timing.count,
      lastMs: Math.round(timing.last),
      avgMs: Math.round(timing.total / Math.max(1, timing.count)),
      maxMs: Math.round(timing.max),
    };
  });

  const live: Record<string, unknown> = {};
  snapshotProviders.forEach((provider, name) => {
    try {
      live[name] = provider();
    } catch {
      live[name] = null;
    }
  });

  return {
    counters: Object.fromEntries(counters),
    timings: timingSummary,
    live,
  };
}

function resetPerf(): void {
  counters.clear();
  timings.clear();
}

function installPerfDebugHandle(): void {
  if (typeof window === 'undefined') {
    return;
  }
  (window as unknown as { __ohifPerf?: unknown }).__ohifPerf = {
    snapshot: getPerfSnapshot,
    reset: resetPerf,
  };
}

export {
  countPerf,
  getPerfSnapshot,
  installPerfDebugHandle,
  recordPerfTiming,
  registerPerfSnapshotProvider,
  resetPerf,
};
