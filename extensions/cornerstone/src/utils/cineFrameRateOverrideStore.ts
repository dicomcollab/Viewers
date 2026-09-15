const US_CINE_DEFAULT_FPS = 4;

const userFrameRates = new Map<string, number>();

function overrideKey(viewportId: string, displaySetUid: string): string {
  return `${viewportId}::${displaySetUid}`;
}

function setUserCineFrameRate(
  viewportId: string,
  displaySetUid: string | null | undefined,
  frameRate: number
): void {
  if (!viewportId || !displaySetUid) {
    return;
  }

  const valid = Math.max(1, Math.round(Number(frameRate) || 1));
  userFrameRates.set(overrideKey(viewportId, displaySetUid), valid);
}

function getUserCineFrameRate(
  viewportId: string,
  displaySetUid: string | null | undefined
): number | undefined {
  if (!viewportId || !displaySetUid) {
    return undefined;
  }

  return userFrameRates.get(overrideKey(viewportId, displaySetUid));
}

function clearUserCineFrameRates(): void {
  userFrameRates.clear();
}

/**
 * User-chosen FPS always wins. Otherwise keep a real stored rate, and only
 * replace the 4 FPS placeholder when this instance has no user override.
 */
function resolveCineFrameRate({
  viewportId,
  displaySetUid,
  storedFrameRate,
  dicomFrameRate,
  sameInstance,
}: {
  viewportId: string;
  displaySetUid?: string | null;
  storedFrameRate?: number | null;
  dicomFrameRate: number;
  sameInstance: boolean;
}): number {
  const override = getUserCineFrameRate(viewportId, displaySetUid);

  if (override != null) {
    return override;
  }

  if (
    sameInstance &&
    storedFrameRate != null &&
    Number.isFinite(storedFrameRate) &&
    storedFrameRate !== US_CINE_DEFAULT_FPS
  ) {
    return storedFrameRate;
  }

  return dicomFrameRate;
}

/**
 * IMAGE_RENDERED / cine play used to treat 4 FPS as "unset" and snap back to
 * the DICOM recommended rate. Do that only when the doctor has not chosen FPS.
 */
function shouldReplacePlaceholderFrameRate(
  viewportId: string,
  displaySetUid: string | null | undefined,
  currentFrameRate: number | null | undefined,
  dicomFrameRate: number | null | undefined
): boolean {
  if (getUserCineFrameRate(viewportId, displaySetUid) != null) {
    return false;
  }

  if (!dicomFrameRate || currentFrameRate === dicomFrameRate) {
    return false;
  }

  return currentFrameRate == null || currentFrameRate === US_CINE_DEFAULT_FPS;
}

export {
  clearUserCineFrameRates,
  getUserCineFrameRate,
  resolveCineFrameRate,
  setUserCineFrameRate,
  shouldReplacePlaceholderFrameRate,
};
