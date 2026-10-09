import { cache } from '@cornerstonejs/core';
import dicomImageLoader from '@cornerstonejs/dicom-image-loader';
import { abortActiveImageRequests } from './imageRequestSession';
import { resetOriginalSyntaxState } from './instanceTransferSyntax';
import { resetDataSetCacheBudget } from './dataSetCacheBudget';

type WadoUriCaches = {
  dataSetCacheManager?: { purge?: () => void };
  fileManager?: { purge?: () => void };
};

/** Route (mode + data source) and StudyInstanceUIDs of the study this tab last opened. */
let openedStudyKey: string | null = null;

function getStudyKeyFromUrl(): string {
  if (typeof window === 'undefined') {
    return '';
  }
  let studyInstanceUIDs = '';
  new URLSearchParams(window.location.search).forEach((value, name) => {
    if (name.toLowerCase() === 'studyinstanceuids') {
      studyInstanceUIDs = value;
    }
  });
  return `${window.location.pathname.replace(/\/+$/, '')}?${studyInstanceUIDs}`;
}

/**
 * Study switch in the same tab (RIS LOAD_STUDY): cancel the previous study's
 * downloads and drop everything it decoded or downloaded, so the next study
 * starts with free request slots and memory and loads from the PACS.
 */
function releaseStudyImageResources(): void {
  const aborted = abortActiveImageRequests();

  try {
    cache.purgeCache();
  } catch (error) {
    console.warn('[releaseStudyImageResources] Image cache purge failed:', error);
  }

  const wadouri = (dicomImageLoader as unknown as { wadouri?: WadoUriCaches }).wadouri;
  try {
    wadouri?.dataSetCacheManager?.purge?.();
    wadouri?.fileManager?.purge?.();
  } catch (error) {
    console.warn('[releaseStudyImageResources] DICOM file cache purge failed:', error);
  }

  resetDataSetCacheBudget();
  resetOriginalSyntaxState();

  if (aborted) {
    console.info(`[releaseStudyImageResources] Cancelled ${aborted} image download(s) of the previous study`);
  }
}

/**
 * Mode enter: release only when this tab already showed a different study (or the same
 * study through another data source). The first study of a tab has nothing to release.
 */
export function releaseStudyImageResourcesIfStudyChanged(): void {
  const studyKey = getStudyKeyFromUrl();
  if (openedStudyKey !== null && openedStudyKey !== studyKey) {
    releaseStudyImageResources();
  }
  openedStudyKey = studyKey;
}
