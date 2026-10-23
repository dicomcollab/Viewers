/**
 * Shared *wake-up* only — not a shared FPS.
 *
 * Each playing viewport still advances on its own frameRate / periodMs (MedDream-
 * style: tile A at 30 FPS, tile B at 60 FPS independently). This module only
 * replaces N separate setIntervals with one timer that calls every registered
 * tick; each tick decides for itself whether its next frame is due.
 *
 * Interval stays at 8 ms so a 90 FPS clip can still hit its deadlines; one 8 ms
 * loop is much cheaper than four independent 8 ms loops on a 2×2 layout.
 */
const TICK_MS = 8;

type TickFn = () => void;

const ticks = new Map<string, TickFn>();
let timer: ReturnType<typeof setInterval> | null = null;

function ensureTicker(): void {
  if (timer != null || typeof window === 'undefined') {
    return;
  }
  timer = window.setInterval(() => {
    ticks.forEach(fn => {
      try {
        fn();
      } catch (error) {
        console.warn('[cineSharedTicker] tick failed', error);
      }
    });
  }, TICK_MS);
}

function stopTickerIfIdle(): void {
  if (ticks.size || timer == null) {
    return;
  }
  window.clearInterval(timer);
  timer = null;
}

function registerCineTick(id: string, fn: TickFn): void {
  if (!id) {
    return;
  }
  ticks.set(id, fn);
  ensureTicker();
}

function unregisterCineTick(id: string): void {
  if (!id) {
    return;
  }
  ticks.delete(id);
  stopTickerIfIdle();
}

function getCineSharedTickMs(): number {
  return TICK_MS;
}

function getRegisteredCineTickCount(): number {
  return ticks.size;
}

export {
  getCineSharedTickMs,
  getRegisteredCineTickCount,
  registerCineTick,
  unregisterCineTick,
};
