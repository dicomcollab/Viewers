import { DicomMetadataStore } from '@ohif/core';
import { getActiveStudyInstanceUID } from './getActiveStudyInstanceUID';
import { parseS3KeyMetadata } from './parseS3KeyMetadata';

type ViewportLike = {
  getImageIds?: () => string[];
  getCurrentImageId?: () => string | undefined;
  getCurrentImageIdIndex?: () => number;
};

export type KeyImageViewportContext = {
  imageId?: string;
  imageIndex?: number;
  studyInstanceUID?: string | null;
  seriesInstanceUID?: string;
  sopInstanceUID?: string;
  frameNumber?: number | null;
  displaySetInstanceUID?: string;
};

function getDisplaySetInstances(displaySet: any): any[] {
  if (!displaySet) {
    return [];
  }
  if (Array.isArray(displaySet.images) && displaySet.images.length) {
    return displaySet.images;
  }
  if (Array.isArray(displaySet.instances) && displaySet.instances.length) {
    return displaySet.instances;
  }
  return [];
}

function findInstanceInDisplaySet(
  displaySet: any,
  { imageId, imageIndex }: { imageId?: string; imageIndex?: number }
) {
  const instances = getDisplaySetInstances(displaySet);
  if (!instances.length) {
    return null;
  }

  if (imageId) {
    const byImageId = instances.find(instance => instance?.imageId === imageId);
    if (byImageId) {
      return byImageId;
    }
  }

  if (imageIndex !== undefined && imageIndex !== null && imageIndex >= 0 && imageIndex < instances.length) {
    return instances[imageIndex];
  }

  return null;
}

/**
 * Resolves study/series/SOP + image index for the active viewport.
 * Prefer metadata from the current image, then fall back to the active display set
 * and hanging-protocol study UID so key-image add works even when
 * DicomMetadataStore imageId lookup fails.
 */
export function resolveKeyImageViewportContext({
  servicesManager,
  activeViewportId,
  viewport,
}: {
  servicesManager: AppTypes.ServicesManager;
  activeViewportId: string;
  viewport?: ViewportLike | null;
}): KeyImageViewportContext {
  const { displaySetService, viewportGridService } = servicesManager.services as AppTypes.Services;

  const imageIds = typeof viewport?.getImageIds === 'function' ? viewport.getImageIds() || [] : [];
  const currentImageIndex =
    typeof viewport?.getCurrentImageIdIndex === 'function'
      ? viewport.getCurrentImageIdIndex()
      : undefined;
  const imageId =
    (typeof viewport?.getCurrentImageId === 'function' ? viewport.getCurrentImageId() : undefined) ||
    (Array.isArray(imageIds) &&
    currentImageIndex !== undefined &&
    currentImageIndex >= 0 &&
    currentImageIndex < imageIds.length
      ? imageIds[currentImageIndex]
      : undefined);

  let imageIndex =
    imageId && Array.isArray(imageIds) ? imageIds.indexOf(imageId) : undefined;
  if ((imageIndex === undefined || imageIndex < 0) && Number.isFinite(currentImageIndex)) {
    imageIndex = currentImageIndex as number;
  }

  let instance = null;
  if (imageId) {
    try {
      instance = DicomMetadataStore.getInstanceByImageId(imageId);
    } catch {
      instance = null;
    }
  }

  const displaySetUIDs =
    viewportGridService.getDisplaySetsUIDsForViewport(activeViewportId) || [];
  const displaySet = displaySetUIDs
    .map(uid => displaySetService.getDisplaySetByUID(uid))
    .find(Boolean);

  if (!instance && displaySet) {
    instance = findInstanceInDisplaySet(displaySet, { imageId, imageIndex });
  }

  if (
    (imageIndex === undefined || imageIndex < 0) &&
    instance?.SOPInstanceUID &&
    displaySet
  ) {
    const instances = getDisplaySetInstances(displaySet);
    const idx = instances.findIndex(
      item => item?.SOPInstanceUID === instance.SOPInstanceUID
    );
    if (idx >= 0) {
      imageIndex = idx;
    }
  }

  const studyInstanceUID =
    instance?.StudyInstanceUID ||
    displaySet?.StudyInstanceUID ||
    getActiveStudyInstanceUID(servicesManager) ||
    null;

  return {
    imageId: imageId || instance?.imageId,
    imageIndex: imageIndex !== undefined && imageIndex >= 0 ? imageIndex : undefined,
    studyInstanceUID,
    seriesInstanceUID: instance?.SeriesInstanceUID || displaySet?.SeriesInstanceUID,
    sopInstanceUID: instance?.SOPInstanceUID,
    frameNumber: instance?.frameNumber ?? null,
    displaySetInstanceUID: displaySet?.displaySetInstanceUID || displaySet?.uid,
  };
}

function getAllDisplaySets(displaySetService: AppTypes.DisplaySetService): any[] {
  const cache = displaySetService.getDisplaySetCache?.();
  if (cache && typeof cache.values === 'function') {
    return [...cache.values()];
  }
  return displaySetService.getActiveDisplaySets?.() || [];
}

function findDisplaySetBySopInstanceUID(
  displaySetService: AppTypes.DisplaySetService,
  sopInstanceUID: string
): any | null {
  if (!sopInstanceUID) {
    return null;
  }

  // Prefer an unscoped lookup — S3-parsed series UIDs are often wrong/outdated
  // and must not restrict the search.
  const fromService =
    displaySetService.getDisplaySetForSOPInstanceUID?.(sopInstanceUID, undefined) || null;
  if (fromService) {
    return fromService;
  }

  return (
    getAllDisplaySets(displaySetService).find(ds =>
      getDisplaySetInstances(ds).some(instance => instance?.SOPInstanceUID === sopInstanceUID)
    ) || null
  );
}

function findDisplaySetViaMetadataStore(
  displaySetService: AppTypes.DisplaySetService,
  {
    studyInstanceUID,
    seriesInstanceUID,
    sopInstanceUID,
  }: {
    studyInstanceUID?: string;
    seriesInstanceUID?: string;
    sopInstanceUID?: string;
  }
): any | null {
  if (!sopInstanceUID && !seriesInstanceUID) {
    return null;
  }

  try {
    const studies = studyInstanceUID
      ? [DicomMetadataStore.getStudy(studyInstanceUID)].filter(Boolean)
      : DicomMetadataStore.getStudyInstanceUIDs?.()?.map(uid => DicomMetadataStore.getStudy(uid)) ||
        [];

    for (const study of studies) {
      const seriesList = study?.series || [];
      for (const series of seriesList) {
        if (seriesInstanceUID && series.SeriesInstanceUID === seriesInstanceUID) {
          const match = displaySetService.getDisplaySetsForSeries(series.SeriesInstanceUID)?.[0];
          if (match) {
            return match;
          }
        }

        if (
          sopInstanceUID &&
          series.instances?.some(instance => instance?.SOPInstanceUID === sopInstanceUID)
        ) {
          const match = displaySetService.getDisplaySetsForSeries(series.SeriesInstanceUID)?.[0];
          if (match) {
            return match;
          }
        }
      }
    }
  } catch {
    // Metadata store may not expose every helper in all builds.
  }

  return null;
}

function isUidLike(value?: string): boolean {
  return typeof value === 'string' && /^\d+(?:\.\d+)+$/.test(value.trim());
}

function extractUidCandidatesFromS3Key(s3Key: string): string[] {
  return s3Key
    .split('/')
    .map(segment => stripFileNameUidCandidate(segment))
    .filter(isUidLike);
}

function stripFileNameUidCandidate(segment: string): string {
  // Filenames look like: {imageIndex}_{sopUid}_{id}.ext — pull the sop uid out.
  const noExt = segment.replace(/\.(png|jpe?g|gif|webp)$/i, '');
  const parts = noExt.split('_');
  if (parts.length >= 2 && Number.isFinite(Number(parts[0])) && isUidLike(parts[1])) {
    return parts[1];
  }
  return noExt;
}

/**
 * Merge in-memory key image fields with a fresh parse of the S3 key.
 * Prefer explicit fields, but fill gaps / replace empty values from the key path
 * so Go To works even when an older parse stored a bad series UID.
 */
function enrichKeyImageForNavigation(keyImage: {
  id?: string;
  s3Key?: string;
  imageId?: string;
  imageIndex?: number;
  studyInstanceUID?: string;
  seriesInstanceUID?: string;
  sopInstanceUID?: string;
}) {
  const s3Key = keyImage.s3Key || keyImage.id || '';
  const fromKey = parseS3KeyMetadata(s3Key);
  const uidCandidates = extractUidCandidatesFromS3Key(s3Key);

  return {
    imageId: keyImage.imageId,
    studyInstanceUID: keyImage.studyInstanceUID,
    // Re-parse series/sop/index from the S3 key when present — path layout is
    // the source of truth after RIS reload.
    seriesInstanceUID: fromKey.seriesInstanceUID || keyImage.seriesInstanceUID,
    sopInstanceUID: fromKey.sopInstanceUID || keyImage.sopInstanceUID,
    imageIndex:
      fromKey.imageIndex !== undefined && fromKey.imageIndex !== null
        ? fromKey.imageIndex
        : keyImage.imageIndex,
    uidCandidates,
  };
}

/**
 * Finds the display set and image index to open for a saved key image.
 * Lookup order prioritizes SOPInstanceUID across the whole study so a bad
 * S3-parsed SeriesInstanceUID cannot block Go To.
 */
export function resolveKeyImageNavigationTarget({
  servicesManager,
  keyImage,
}: {
  servicesManager: AppTypes.ServicesManager;
  keyImage: {
    id?: string;
    s3Key?: string;
    imageId?: string;
    imageIndex?: number;
    studyInstanceUID?: string;
    seriesInstanceUID?: string;
    sopInstanceUID?: string;
  };
}): {
  displaySet: any | null;
  imageIndex?: number;
  referencedImageId?: string;
} {
  const { displaySetService } = servicesManager.services as AppTypes.Services;
  const resolved = enrichKeyImageForNavigation(keyImage);

  let displaySet =
    (resolved.sopInstanceUID &&
      findDisplaySetBySopInstanceUID(displaySetService, resolved.sopInstanceUID)) ||
    null;

  // sopInstanceUID from an older/bad parse may actually be a series UID (or the
  // panel may only have the S3 key). Try every UID-like candidate as SOP then series.
  if (!displaySet && resolved.uidCandidates?.length) {
    for (const candidate of resolved.uidCandidates) {
      displaySet = findDisplaySetBySopInstanceUID(displaySetService, candidate);
      if (displaySet) {
        if (!resolved.sopInstanceUID) {
          resolved.sopInstanceUID = candidate;
        }
        break;
      }
    }
  }

  if (!displaySet && resolved.seriesInstanceUID) {
    const seriesSets =
      displaySetService.getDisplaySetsForSeries(resolved.seriesInstanceUID) || [];
    displaySet = seriesSets[0] || null;
  }

  if (!displaySet && resolved.uidCandidates?.length) {
    for (const candidate of resolved.uidCandidates) {
      const seriesSets = displaySetService.getDisplaySetsForSeries(candidate) || [];
      if (seriesSets[0]) {
        displaySet = seriesSets[0];
        break;
      }
    }
  }

  if (!displaySet && resolved.imageId) {
    displaySet =
      getAllDisplaySets(displaySetService).find(ds =>
        getDisplaySetInstances(ds).some(instance => instance?.imageId === resolved.imageId)
      ) || null;
  }

  if (!displaySet) {
    displaySet = findDisplaySetViaMetadataStore(displaySetService, {
      studyInstanceUID: resolved.studyInstanceUID,
      seriesInstanceUID: resolved.seriesInstanceUID,
      sopInstanceUID: resolved.sopInstanceUID,
    });
  }

  if (!displaySet) {
    return { displaySet: null };
  }

  const instances = getDisplaySetInstances(displaySet);
  let imageIndex =
    resolved.imageIndex !== undefined &&
    resolved.imageIndex !== null &&
    Number.isFinite(resolved.imageIndex)
      ? resolved.imageIndex
      : undefined;

  if (resolved.sopInstanceUID && instances.length) {
    const sopIndex = instances.findIndex(
      instance => instance?.SOPInstanceUID === resolved.sopInstanceUID
    );
    if (sopIndex >= 0) {
      imageIndex = sopIndex;
    }
  }

  let referencedImageId = resolved.imageId;
  if (!referencedImageId && imageIndex !== undefined && instances[imageIndex]?.imageId) {
    referencedImageId = instances[imageIndex].imageId;
  } else if (!referencedImageId && resolved.sopInstanceUID) {
    referencedImageId = instances.find(
      instance => instance?.SOPInstanceUID === resolved.sopInstanceUID
    )?.imageId;
  }

  return {
    displaySet,
    imageIndex,
    referencedImageId,
  };
}
