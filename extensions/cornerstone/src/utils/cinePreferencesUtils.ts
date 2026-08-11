import type { CinePlayMode } from '../components/CinePlayer/usCineUiUtils';

/**
 * Doctor/RIS cine player preferences.
 *
 * Cookie: userPreferences_cinePreferences
 * Example:
 *   {"showFps":true,"showFr":false,"autoPlay":true}
 *
 * Defaults:
 * - fr (frame-step) is the default cine control
 * - FPS is hidden unless enabled from preferences/settings
 * - Auto-play multiframe ultrasound stacks on load
 */
export type CinePreferences = {
  /** Show the FPS stepper / FPS play mode control. */
  showFps: boolean;
  /** Show the fr (frame-step) stepper / step play mode control. */
  showFr: boolean;
  /** Auto-start cine when multiframe ultrasound (and similar) loads. */
  autoPlay: boolean;
};

export const DEFAULT_CINE_PREFERENCES: CinePreferences = {
  showFps: false,
  showFr: true,
  autoPlay: true,
};

type RawCinePreferences = Partial<{
  showFps: unknown;
  showFr: unknown;
  autoPlay: unknown;
  /** Aliases some RIS payloads may use */
  showFPS: unknown;
  showFrameStep: unknown;
  autoPlayCine: unknown;
}>;

function toBool(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true' || normalized === '1') {
      return true;
    }
    if (normalized === 'false' || normalized === '0') {
      return false;
    }
  }
  if (typeof value === 'number') {
    return value !== 0;
  }
  return fallback;
}

function parseRawCinePreferences(raw: unknown): RawCinePreferences | null {
  if (raw == null) {
    return null;
  }

  let parsed: unknown = raw;
  try {
    while (typeof parsed === 'string') {
      parsed = JSON.parse(parsed);
    }
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null;
  }

  return parsed as RawCinePreferences;
}

function normalizeCinePreferences(raw: RawCinePreferences | null): CinePreferences {
  const defaults = DEFAULT_CINE_PREFERENCES;
  if (!raw) {
    return { ...defaults };
  }

  return {
    showFps: toBool(raw.showFps ?? raw.showFPS, defaults.showFps),
    showFr: toBool(raw.showFr ?? raw.showFrameStep, defaults.showFr),
    autoPlay: toBool(raw.autoPlay ?? raw.autoPlayCine, defaults.autoPlay),
  };
}

/**
 * Resolve cine preferences from cookies (preferred) or window.config.cinePreferences.
 */
function getCinePreferences(): CinePreferences {
  if (typeof window === 'undefined') {
    return { ...DEFAULT_CINE_PREFERENCES };
  }

  const win = window as Window & {
    getPreferencesFromCookies?: () => { cinePreferences?: unknown } | null;
    config?: { cinePreferences?: unknown; autoPlayCine?: boolean };
  };

  let fromCookies: unknown;
  try {
    fromCookies = win.getPreferencesFromCookies?.()?.cinePreferences;
  } catch {
    fromCookies = undefined;
  }

  const fromConfig = win.config?.cinePreferences;
  const prefs = normalizeCinePreferences(
    parseRawCinePreferences(fromCookies ?? fromConfig)
  );

  // Legacy appConfig.autoPlayCine overrides only when cookie/config did not set autoPlay.
  if (
    fromCookies == null &&
    fromConfig == null &&
    typeof win.config?.autoPlayCine === 'boolean'
  ) {
    prefs.autoPlay = win.config.autoPlayCine;
  }

  return prefs;
}

/**
 * Default play mode from visibility: prefer fr (step) first.
 * FPS is used only when the doctor enables it from settings.
 */
function getDefaultCinePlayMode(prefs: CinePreferences = getCinePreferences()): CinePlayMode {
  if (prefs.showFr) {
    return 'step';
  }
  if (prefs.showFps) {
    return 'fps';
  }
  return 'fps';
}

function shouldAutoPlayCine(
  prefs: CinePreferences = getCinePreferences(),
  _appConfigAutoPlay?: boolean
): boolean {
  return prefs.autoPlay;
}

export {
  getCinePreferences,
  getDefaultCinePlayMode,
  normalizeCinePreferences,
  shouldAutoPlayCine,
};
