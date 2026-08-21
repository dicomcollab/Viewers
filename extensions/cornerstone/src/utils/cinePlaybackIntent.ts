import { getCinePreferences, shouldAutoPlayCine } from './cinePreferencesUtils';

/**
 * Study-level play intent, independent of which viewports currently exist.
 *
 * `null` means the doctor has not pressed play/pause yet — follow autoplay
 * preference for ultrasound only (enforced in CinePlayer / ensureLayoutCinePlayback).
 * Layout changes (1×1 ↔ 2×2) must honour this so new US tiles actually run cine
 * instead of only showing a pause icon because another tile is playing.
 *
 * Non-US modalities (CT/MR multi-slice, etc.) must never autoplay from this flag.
 */
let studyCineWantsPlaying: boolean | null = null;

function setStudyCineWantsPlaying(playing: boolean): void {
  studyCineWantsPlaying = playing;
}

function getStudyCineWantsPlaying(): boolean {
  if (studyCineWantsPlaying != null) {
    return studyCineWantsPlaying;
  }

  return shouldAutoPlayCine(getCinePreferences());
}

export { getStudyCineWantsPlaying, setStudyCineWantsPlaying };
