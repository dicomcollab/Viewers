/**
 * Study-level cine sync mode.
 *
 * - none: every viewport keeps its own play state, FPS and frame position.
 * - syncStart: pressing play starts every cine viewport together from the first
 *   frame, but each instance keeps its own DICOM-derived FPS (clips drift apart).
 * - syncPlayback: play state, FPS, play mode and frame position are shared, so
 *   all viewports stay locked to the same timeline.
 */
export type CineSyncMode = 'none' | 'syncStart' | 'syncPlayback';

export const DEFAULT_CINE_SYNC_MODE: CineSyncMode = 'syncPlayback';

type CineSyncModeOption = {
  value: CineSyncMode;
  label: string;
  description: string;
  /** Letter drawn next to the link icon, MedDream style. */
  badge: string;
};

export const CINE_SYNC_MODE_OPTIONS: CineSyncModeOption[] = [
  {
    value: 'none',
    label: 'No sync play',
    description: 'Each viewport plays, pauses and scrolls on its own.',
    badge: '',
  },
  {
    value: 'syncStart',
    label: 'Play sync start',
    description: 'All loops start together; completed loops wait until every loop finishes.',
    badge: 'S',
  },
  {
    value: 'syncPlayback',
    label: 'Sync playback',
    description: 'Play and pause affect every cine viewport in the layout.',
    badge: 'P',
  },
];

/** Click order of the single cine sync button. */
const CINE_SYNC_MODE_CYCLE: CineSyncMode[] = ['none', 'syncStart', 'syncPlayback'];

export function getNextCineSyncMode(mode: CineSyncMode): CineSyncMode {
  const index = CINE_SYNC_MODE_CYCLE.indexOf(mode);

  return CINE_SYNC_MODE_CYCLE[(index + 1) % CINE_SYNC_MODE_CYCLE.length];
}

const MODE_ALIASES: Record<string, CineSyncMode> = {
  none: 'none',
  off: 'none',
  independent: 'none',
  nosync: 'none',
  syncstart: 'syncStart',
  start: 'syncStart',
  playsyncstart: 'syncStart',
  syncplayback: 'syncPlayback',
  playback: 'syncPlayback',
  full: 'syncPlayback',
};

export function normalizeCineSyncMode(
  value: unknown,
  fallback: CineSyncMode = DEFAULT_CINE_SYNC_MODE
): CineSyncMode {
  if (typeof value !== 'string') {
    return fallback;
  }

  return MODE_ALIASES[value.trim().toLowerCase().replace(/[\s_-]/g, '')] ?? fallback;
}

let currentMode: CineSyncMode | null = null;
const listeners = new Set<(mode: CineSyncMode) => void>();

function readConfiguredMode(): CineSyncMode {
  if (typeof window === 'undefined') {
    return DEFAULT_CINE_SYNC_MODE;
  }

  const win = window as Window & {
    getPreferencesFromCookies?: () => { cinePreferences?: unknown } | null;
    config?: { cinePreferences?: unknown };
  };

  const readSyncMode = (raw: unknown): unknown => {
    let parsed: unknown = raw;

    try {
      while (typeof parsed === 'string') {
        parsed = JSON.parse(parsed);
      }
    } catch {
      return undefined;
    }

    if (!parsed || typeof parsed !== 'object') {
      return undefined;
    }

    const prefs = parsed as { syncMode?: unknown; cineSyncMode?: unknown };

    return prefs.syncMode ?? prefs.cineSyncMode;
  };

  let fromCookies: unknown;
  try {
    fromCookies = readSyncMode(win.getPreferencesFromCookies?.()?.cinePreferences);
  } catch {
    fromCookies = undefined;
  }

  return normalizeCineSyncMode(
    fromCookies ?? readSyncMode(win.config?.cinePreferences),
    DEFAULT_CINE_SYNC_MODE
  );
}

export function getCineSyncMode(): CineSyncMode {
  if (currentMode == null) {
    currentMode = readConfiguredMode();
  }

  return currentMode;
}

export function setCineSyncMode(mode: CineSyncMode): void {
  const next = normalizeCineSyncMode(mode, getCineSyncMode());

  if (next === currentMode) {
    return;
  }

  currentMode = next;

  listeners.forEach(listener => listener(next));
}

export function subscribeCineSyncMode(listener: (mode: CineSyncMode) => void): () => void {
  listeners.add(listener);

  return () => listeners.delete(listener);
}

export function getCineSyncModeOption(mode: CineSyncMode): CineSyncModeOption {
  return CINE_SYNC_MODE_OPTIONS.find(option => option.value === mode) ?? CINE_SYNC_MODE_OPTIONS[0];
}

export function isCineSyncEnabled(mode: CineSyncMode = getCineSyncMode()): boolean {
  return mode !== 'none';
}
