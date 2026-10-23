import { useCallback } from 'react';
import { useSystem } from '@ohif/core';
import getImageSrcFromImageId from '../Panels/getImageSrcFromImageId';
import { normalizeJpegImageId } from '../DicomWebDataSource/utils/getImageId';

function getImageIdForThumbnail(displaySet, imageIds: string[]) {
  let imageId: string | undefined;
  if (displaySet.isDynamicVolume) {
    const timePoints = displaySet.dynamicVolumeInfo?.timePoints;
    if (!timePoints?.length) {
      return null;
    }
    const middleIndex = Math.floor(timePoints.length / 2);
    const middleTimePointImageIds = timePoints[middleIndex];
    imageId = middleTimePointImageIds[Math.floor(middleTimePointImageIds.length / 2)];
  } else if (imageIds?.length) {
    // US: frame 0 matches viewport open + cache; others use middle frame.
    const index = displaySet.Modality === 'US' ? 0 : Math.floor(imageIds.length / 2);
    imageId = imageIds[index];
  }
  return imageId ? normalizeJpegImageId(imageId) : null;
}

/**
 * Load (and cache on the display set) a thumbnail data URL — same path as Study Browser.
 */
export async function loadMobileThumbnailSrc({
  displaySet,
  dataSource,
  getImageSrc,
}: {
  displaySet: any;
  dataSource: any;
  getImageSrc: (imageId: string) => Promise<string>;
}): Promise<string | null> {
  if (!displaySet || displaySet.unsupported || !dataSource || !getImageSrc) {
    return null;
  }

  if (displaySet.thumbnailSrc) {
    return displaySet.thumbnailSrc;
  }

  let imageIds: string[] = [];
  try {
    imageIds = dataSource.getImageIdsForDisplaySet?.(displaySet) || [];
  } catch {
    imageIds = [];
  }

  const imageId = getImageIdForThumbnail(displaySet, imageIds);
  if (!imageId) {
    return null;
  }

  let thumbnailSrc: string | null = null;

  if (displaySet.getThumbnailSrc) {
    try {
      thumbnailSrc = await displaySet.getThumbnailSrc({ getImageSrc });
    } catch {
      thumbnailSrc = null;
    }
  }

  if (!thumbnailSrc) {
    try {
      thumbnailSrc = await getImageSrc(imageId);
    } catch (error) {
      console.warn('[mobile] thumbnail failed', displaySet.displaySetInstanceUID, error);
      return null;
    }
  }

  if (thumbnailSrc) {
    displaySet.thumbnailSrc = thumbnailSrc;
  }

  return thumbnailSrc;
}

/** Hook: active data source + cornerstone-backed getImageSrc for mobile thumbnails. */
export function useMobileThumbnailLoader() {
  const { extensionManager } = useSystem();

  const getImageSrc = useCallback(
    async (imageId: string) => {
      const utilities = extensionManager.getModuleEntry(
        '@ohif/extension-cornerstone.utilityModule.common'
      );
      if (!utilities?.exports?.getCornerstoneLibraries) {
        throw new Error('Cornerstone utilities unavailable for thumbnail');
      }
      const { cornerstone } = utilities.exports.getCornerstoneLibraries();
      return getImageSrcFromImageId(cornerstone, imageId);
    },
    [extensionManager]
  );

  const loadThumbnail = useCallback(
    (displaySet: any) => {
      // Resolve data source on each call — active source may not be ready on first mount.
      let dataSource = null;
      try {
        dataSource = extensionManager.getActiveDataSource?.()?.[0] || null;
      } catch {
        dataSource = null;
      }
      return loadMobileThumbnailSrc({
        displaySet,
        dataSource,
        getImageSrc,
      });
    },
    [extensionManager, getImageSrc]
  );

  return { loadThumbnail };
}
