/**
 * Session flag for Ultrasound "Frame Distribution" (MedDream-style).
 *
 * When enabled, a single multi-frame US instance is loaded into every
 * viewport of the current layout, each starting at a unique frame offset.
 * This is not a hanging protocol of its own — it is a viewing mode applied
 * on top of the selected grid.
 */
const listeners = new Set<(enabled: boolean) => void>();

let enabled = false;
let batchStart = 0;

export function isUsFrameDistributionEnabled(): boolean {
  return enabled;
}

export function getUsFrameDistributionBatchStart(): number {
  return batchStart;
}

export function setUsFrameDistributionBatchStart(nextBatchStart: number): void {
  batchStart = Math.max(0, Math.round(nextBatchStart) || 0);
}

export function setUsFrameDistributionEnabled(nextEnabled: boolean): void {
  const next = Boolean(nextEnabled);

  if (next === enabled) {
    return;
  }

  enabled = next;

  if (!enabled) {
    batchStart = 0;
  }

  listeners.forEach(listener => listener(enabled));
}

export function subscribeUsFrameDistribution(listener: (enabled: boolean) => void): () => void {
  listeners.add(listener);

  return () => listeners.delete(listener);
}

export function resetUsFrameDistribution(): void {
  batchStart = 0;

  if (!enabled) {
    return;
  }

  enabled = false;
  listeners.forEach(listener => listener(enabled));
}

export function getUsImageDisplaySets(displaySetService): any[] {
  return (displaySetService?.activeDisplaySets ?? []).filter(
    ds => ds?.Modality === 'US' && !ds.unsupported && (ds.numImageFrames ?? 0) > 0
  );
}

/**
 * Frame Distribution is only offered when the study has exactly one US
 * image instance and that instance is multi-frame.
 */
export function canUseUsFrameDistribution(displaySetService): boolean {
  const usSets = getUsImageDisplaySets(displaySetService);

  return usSets.length === 1 && (usSets[0].numImageFrames ?? 0) > 1;
}

export function getSrDisplaySets(displaySetService, studyInstanceUID?: string) {
  return (displaySetService?.activeDisplaySets ?? [])
    .filter(
      ds =>
        ds?.Modality === 'SR' &&
        !ds.unsupported &&
        (!studyInstanceUID || ds.StudyInstanceUID === studyInstanceUID)
    )
    .sort((a, b) => {
      const aSeries = Number(a.SeriesNumber ?? 0);
      const bSeries = Number(b.SeriesNumber ?? 0);

      if (aSeries !== bSeries) {
        return aSeries - bSeries;
      }

      return String(a.displaySetInstanceUID).localeCompare(String(b.displaySetInstanceUID));
    });
}

export function getSingleUsMultiframeDisplaySet(displaySetService) {
  const usSets = getUsImageDisplaySets(displaySetService);

  if (usSets.length !== 1 || (usSets[0].numImageFrames ?? 0) <= 1) {
    return null;
  }

  return usSets[0];
}
