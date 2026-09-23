/**
 * Exact Study Panel thumbnail order for PgUp/PgDn next-series navigation.
 * Updated whenever the study panel finishes mapping/sorting thumbnails so
 * keyboard navigation matches what the user sees (including images-then-SR).
 */

let orderedDisplaySetInstanceUIDs: string[] = [];

export function setStudyPanelNavigationOrder(displaySetInstanceUIDs: string[]): void {
  orderedDisplaySetInstanceUIDs = Array.isArray(displaySetInstanceUIDs)
    ? [...displaySetInstanceUIDs]
    : [];
}

export function getStudyPanelNavigationOrder(): string[] {
  return [...orderedDisplaySetInstanceUIDs];
}

export function clearStudyPanelNavigationOrder(): void {
  orderedDisplaySetInstanceUIDs = [];
}
