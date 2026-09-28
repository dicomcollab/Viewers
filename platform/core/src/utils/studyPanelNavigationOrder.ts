/**
 * Shared Study Panel thumbnail sequence (platform-core).
 * Default extension publishes; HangingProtocolService and viewport sync consume.
 */

let orderedDisplaySetInstanceUIDs: string[] = [];
const listeners = new Set<() => void>();

export function setStudyPanelNavigationOrder(displaySetInstanceUIDs: string[]): void {
  const next = Array.isArray(displaySetInstanceUIDs) ? [...displaySetInstanceUIDs] : [];
  const unchanged =
    next.length === orderedDisplaySetInstanceUIDs.length &&
    next.every((uid, i) => uid === orderedDisplaySetInstanceUIDs[i]);

  orderedDisplaySetInstanceUIDs = next;

  if (!unchanged) {
    listeners.forEach(listener => {
      try {
        listener();
      } catch (error) {
        console.warn('[studyPanelNavigationOrder] listener failed', error);
      }
    });
  }
}

export function getStudyPanelNavigationOrder(): string[] {
  return [...orderedDisplaySetInstanceUIDs];
}

export function clearStudyPanelNavigationOrder(): void {
  orderedDisplaySetInstanceUIDs = [];
  listeners.forEach(listener => {
    try {
      listener();
    } catch {
      // ignore
    }
  });
}

export function subscribeStudyPanelNavigationOrder(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
