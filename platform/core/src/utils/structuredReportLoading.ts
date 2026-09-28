/**
 * Tracks an SR that was requested (e.g. thumbnail double-click) but is not yet painted,
 * so the viewport grid can show a loading overlay and SR viewports can clear it once rendered.
 */

export type StructuredReportLoadingPhase = 'loading' | 'assigned';

export type StructuredReportLoadingState = {
  displaySetInstanceUID: string | null;
  phase: StructuredReportLoadingPhase;
  startedAt: number;
} | null;

const SAFETY_TIMEOUT_MS = 45000;

let state: StructuredReportLoadingState = null;
let safetyTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  listeners.forEach(listener => {
    try {
      listener();
    } catch (error) {
      console.warn('[structuredReportLoading] listener failed', error);
    }
  });
}

function clearSafetyTimer(): void {
  if (safetyTimer) {
    clearTimeout(safetyTimer);
    safetyTimer = null;
  }
}

export function startStructuredReportLoading(displaySetInstanceUID?: string | null): void {
  clearSafetyTimer();
  state = {
    displaySetInstanceUID: displaySetInstanceUID || null,
    phase: 'loading',
    startedAt: Date.now(),
  };
  safetyTimer = setTimeout(() => finishStructuredReportLoading(), SAFETY_TIMEOUT_MS);
  notify();
}

/** The SR has been handed to a viewport in the final layout; rendering may still be in progress. */
export function markStructuredReportAssigned(displaySetInstanceUID?: string | null): void {
  if (!state) {
    return;
  }
  state = {
    ...state,
    displaySetInstanceUID: displaySetInstanceUID || state.displaySetInstanceUID,
    phase: 'assigned',
  };
  notify();
}

/** Clears the loading state. When a UID is given, only clears if it matches the pending SR. */
export function finishStructuredReportLoading(displaySetInstanceUID?: string | null): void {
  if (!state) {
    return;
  }
  if (
    displaySetInstanceUID &&
    state.displaySetInstanceUID &&
    state.displaySetInstanceUID !== displaySetInstanceUID
  ) {
    return;
  }
  clearSafetyTimer();
  state = null;
  notify();
}

export function getStructuredReportLoading(): StructuredReportLoadingState {
  return state ? { ...state } : null;
}

export function subscribeStructuredReportLoading(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
