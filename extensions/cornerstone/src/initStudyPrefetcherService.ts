import {
  cache,
  imageLoadPoolManager,
  imageLoader,
  Enums,
  eventTarget,
  EVENTS as csEvents,
} from '@cornerstonejs/core';

const { Events } = Enums;

function initStudyPrefetcherService(servicesManager: AppTypes.ServicesManager) {
  const { studyPrefetcherService } = servicesManager.services;

  studyPrefetcherService.requestType = Enums.RequestType.Prefetch;
  studyPrefetcherService.imageLoadPoolManager = imageLoadPoolManager;
  studyPrefetcherService.imageLoader = imageLoader;

  studyPrefetcherService.cache = {
    isImageCached(imageId: string): boolean {
      return !!cache.getImageLoadObject(imageId);
    }
  }

  studyPrefetcherService.imageLoadEventsManager = {
    addEventListeners(onImageLoaded, onImageLoadFailed) {
      eventTarget.addEventListener(csEvents.IMAGE_LOADED, onImageLoaded);
      eventTarget.addEventListener(csEvents.IMAGE_LOAD_FAILED, onImageLoadFailed);

      return [
        {
          unsubscribe: () => eventTarget.removeEventListener(csEvents.IMAGE_LOADED, onImageLoaded)
        },
        {
          unsubscribe: () => eventTarget.removeEventListener(csEvents.IMAGE_LOAD_FAILED, onImageLoadFailed)
        },
      ]
    }
  }

  const onVolumeModified = (evt: CustomEvent) => {
    const detail = evt?.detail || {};
    const volumeId = detail?.volumeId;
    if (!volumeId) {
      return;
    }

    const volume = cache.getVolume(volumeId) as
      | {
          loadStatus?: {
            framesProcessed?: number;
            framesLoaded?: number;
            totalNumFrames?: number;
          };
          imageIds?: string[];
        }
      | undefined;

    // Different cornerstone versions report different keys; normalize them.
    const framesProcessed =
      detail?.framesProcessed ??
      detail?.framesLoaded ??
      volume?.loadStatus?.framesProcessed ??
      volume?.loadStatus?.framesLoaded;
    const numberOfFrames =
      detail?.numberOfFrames ??
      detail?.totalNumFrames ??
      volume?.loadStatus?.totalNumFrames ??
      volume?.imageIds?.length;

    if (framesProcessed == null || numberOfFrames == null) {
      return;
    }
    studyPrefetcherService.notifyVolumeStreamProgress(volumeId, framesProcessed, numberOfFrames);
  };

  const onVolumeLoadingCompleted = (evt: CustomEvent) => {
    const volumeId = evt?.detail?.volumeId;
    if (volumeId) {
      studyPrefetcherService.notifyVolumeFullyLoaded(volumeId);
    }
  };

  eventTarget.addEventListener(Events.IMAGE_VOLUME_MODIFIED, onVolumeModified);
  eventTarget.addEventListener(Events.IMAGE_VOLUME_LOADING_COMPLETED, onVolumeLoadingCompleted);
}

export default initStudyPrefetcherService;
