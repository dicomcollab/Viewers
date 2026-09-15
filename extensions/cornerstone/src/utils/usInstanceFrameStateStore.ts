import { isUsMultiframeDisplaySet } from './cineSyncUtils';

type UsInstanceFrameState = {
  frameIndex: number;
};

const instanceFrames = new Map<string, UsInstanceFrameState>();
let trackedStudyUID: string | null = null;

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  return null;
}

function getUsInstanceUids(displaySet): {
  StudyInstanceUID: string;
  SeriesInstanceUID: string;
  SOPInstanceUID: string;
} | null {
  if (!isUsMultiframeDisplaySet(displaySet)) {
    return null;
  }

  const instance =
    displaySet.instance ??
    displaySet.instances?.[0] ??
    displaySet.images?.[0] ??
    (typeof displaySet.getImage === 'function' ? displaySet.getImage(0) : undefined);

  const StudyInstanceUID = firstString(displaySet.StudyInstanceUID, instance?.StudyInstanceUID);
  const SeriesInstanceUID = firstString(displaySet.SeriesInstanceUID, instance?.SeriesInstanceUID);
  const SOPInstanceUID = firstString(
    displaySet.SOPInstanceUID,
    instance?.SOPInstanceUID,
    instance?.SopInstanceUID
  );

  if (!StudyInstanceUID || !SeriesInstanceUID || !SOPInstanceUID) {
    return null;
  }

  return { StudyInstanceUID, SeriesInstanceUID, SOPInstanceUID };
}

function getUsInstanceFrameKey(displaySet): string | null {
  const uids = getUsInstanceUids(displaySet);

  if (!uids) {
    return null;
  }

  return `${uids.StudyInstanceUID}|${uids.SeriesInstanceUID}|${uids.SOPInstanceUID}`;
}

function noteStudyUID(studyUID: string | null): void {
  if (!studyUID) {
    return;
  }

  if (trackedStudyUID && trackedStudyUID !== studyUID) {
    instanceFrames.clear();
  }

  trackedStudyUID = studyUID;
}

function saveUsInstanceFrame(displaySet, frameIndex: number): void {
  const uids = getUsInstanceUids(displaySet);
  const key = getUsInstanceFrameKey(displaySet);

  if (!uids || !key || !Number.isFinite(frameIndex)) {
    return;
  }

  noteStudyUID(uids.StudyInstanceUID);
  instanceFrames.set(key, { frameIndex: Math.max(0, Math.round(frameIndex)) });
}

function getUsInstanceFrame(displaySet): number | undefined {
  const key = getUsInstanceFrameKey(displaySet);

  if (!key) {
    return undefined;
  }

  return instanceFrames.get(key)?.frameIndex;
}

/**
 * First view of this SOP → frame 0 (DICOM frame 1).
 * Returning to a previously viewed SOP → last saved index.
 */
function resolveUsInstanceInitialFrameIndex(displaySet, frameCount?: number): number {
  const saved = getUsInstanceFrame(displaySet);
  const lastIndex =
    Number.isFinite(frameCount) && (frameCount as number) > 0 ? (frameCount as number) - 1 : null;
  const index = saved ?? 0;

  if (lastIndex == null) {
    return Math.max(0, index);
  }

  return Math.max(0, Math.min(lastIndex, index));
}

function hasUsInstanceFrameState(displaySet): boolean {
  return getUsInstanceFrame(displaySet) != null;
}

function clearUsInstanceFrameState(): void {
  instanceFrames.clear();
  trackedStudyUID = null;
}

export {
  clearUsInstanceFrameState,
  getUsInstanceFrame,
  getUsInstanceFrameKey,
  getUsInstanceUids,
  hasUsInstanceFrameState,
  resolveUsInstanceInitialFrameIndex,
  saveUsInstanceFrame,
};
