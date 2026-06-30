import { DicomMetadataStore } from '@ohif/core';
import { getActiveStudyInstanceUID } from './utils/getActiveStudyInstanceUID';
import { getKeyImagesAuthHeader } from './utils/getKeyImagesAuthHeader';
import {
  deleteKeyImageFromRis,
  uploadKeyImagesToRis,
} from './utils/keyImagesApi';
import { captureKeyImage } from './utils/captureKeyImage';

function refreshAddKeyImageToolbar(servicesManager, viewportId?: string) {
  const { toolbarService } = servicesManager.services;
  toolbarService?.refreshToolbarState?.({
    viewportId,
    itemId: 'AddKeyImage',
  });
}

function getCommandsModule({ servicesManager, commandsManager, extensionManager }) {
  const {
    viewportGridService,
    cornerstoneViewportService,
    measurementService,
    uiNotificationService,
    keyImagesService,
  } = servicesManager.services as AppTypes.Services & {
    keyImagesService: any;
  };

  const actions = {
    loadKeyImages: async ({ studyInstanceUID } = {}) => {
      const activeStudyUID = studyInstanceUID || getActiveStudyInstanceUID(servicesManager);
      if (!activeStudyUID) {
        return;
      }

      const authHeaders = getKeyImagesAuthHeader(
        typeof window !== 'undefined' ? window.config : undefined
      );
      if (!authHeaders?.Authorization && !authHeaders?.token) {
        return;
      }

      try {
        await keyImagesService.loadKeyImagesForStudy(activeStudyUID);
      } catch (error) {
        uiNotificationService.show({
          title: 'Key Images',
          message: error instanceof Error ? error.message : 'Failed to load key images.',
          type: 'error',
        });
      }
    },

    addKeyImage: async () => {
      const { activeViewportId } = viewportGridService.getState();
      if (!activeViewportId) {
        return;
      }

      if (keyImagesService.isAddingKeyImage()) {
        uiNotificationService.show({
          title: 'Key Images',
          message: 'Adding key image, please wait...',
          type: 'info',
          id: 'key-images-add-in-progress',
          allowDuplicates: false,
          deduplicationInterval: 2000,
        });
        return;
      }

      const viewport = cornerstoneViewportService.getCornerstoneViewport(activeViewportId);
      if (!viewport) {
        uiNotificationService.show({
          title: 'Key Images',
          message: 'No active cornerstone viewport found.',
          type: 'error',
        });
        return;
      }

      const imageIds = typeof viewport.getImageIds === 'function' ? viewport.getImageIds() : [];
      const currentImageIndex =
        typeof viewport.getCurrentImageIdIndex === 'function'
          ? viewport.getCurrentImageIdIndex()
          : undefined;
      const imageId =
        (typeof viewport.getCurrentImageId === 'function'
          ? viewport.getCurrentImageId()
          : undefined) ||
        (Array.isArray(imageIds) &&
        currentImageIndex !== undefined &&
        currentImageIndex >= 0 &&
        currentImageIndex < imageIds.length
          ? imageIds[currentImageIndex]
          : undefined);
      const imageIndex = imageId && Array.isArray(imageIds) ? imageIds.indexOf(imageId) : undefined;

      let instance = null;
      if (imageId) {
        try {
          instance = DicomMetadataStore.getInstanceByImageId(imageId);
        } catch {
          instance = null;
        }
      }

      const studyInstanceUID = instance?.StudyInstanceUID;
      if (!studyInstanceUID) {
        uiNotificationService.show({
          title: 'Key Images',
          message: 'No active study selected. Open a study before adding key images.',
          type: 'warning',
        });
        return;
      }

      const authHeaders = getKeyImagesAuthHeader(
        typeof window !== 'undefined' ? window.config : undefined
      );
      if (!authHeaders?.Authorization && !authHeaders?.token) {
        uiNotificationService.show({
          title: 'Key Images',
          message:
            'Missing API credentials. Sign in to RIS or open the viewer from an authenticated session.',
          type: 'error',
        });
        return;
      }

      if (!keyImagesService.hasLoadedKeyImagesForStudy(studyInstanceUID)) {
        try {
          await keyImagesService.loadKeyImagesForStudy(studyInstanceUID);
        } catch (error) {
          uiNotificationService.show({
            title: 'Key Images',
            message: error instanceof Error ? error.message : 'Failed to load key images.',
            type: 'error',
          });
          return;
        }
      }

      const existingKeyImage = keyImagesService.findKeyImageForInstance({
        studyInstanceUID,
        imageId,
        sopInstanceUID: instance?.SOPInstanceUID,
        frameNumber: instance?.frameNumber ?? null,
      });

      if (existingKeyImage) {
        uiNotificationService.show({
          title: 'Key Images',
          message: 'This image is already in Key Images.',
          type: 'warning',
          id: 'key-images-duplicate',
          allowDuplicates: false,
          deduplicationInterval: 3000,
        });
        return;
      }

      keyImagesService.setAddingKeyImage(true);
      refreshAddKeyImageToolbar(servicesManager, activeViewportId);

      const addPromise = (async () => {
        const { dataUrl, blob } = await captureKeyImage({
          imageId,
          activeViewportId,
          cornerstoneViewportService,
          extensionManager,
        });

        const measurements = measurementService.getMeasurements(
          m =>
            (imageId && m.referencedImageId === imageId) ||
            (instance?.SOPInstanceUID && m.SOPInstanceUID === instance.SOPInstanceUID)
        );

        const pendingKeyImage = {
          id: `key-image-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          imageId,
          imageIndex: imageIndex >= 0 ? imageIndex : undefined,
          viewportId: activeViewportId,
          studyInstanceUID: instance?.StudyInstanceUID,
          seriesInstanceUID: instance?.SeriesInstanceUID,
          sopInstanceUID: instance?.SOPInstanceUID,
          frameNumber: instance?.frameNumber ?? null,
          createdAt: Date.now(),
          dataUrl,
          blob,
          measurements,
        };

        await uploadKeyImagesToRis([pendingKeyImage], extensionManager);
        await keyImagesService.loadKeyImagesForStudy(studyInstanceUID);
      })();

      try {
        uiNotificationService.show({
          title: 'Key Images',
          message: 'Saving key image...',
          promise: addPromise,
          promiseMessages: {
            loading: 'Saving key image to RIS...',
            success: 'Key image saved.',
            error: 'Failed to save key image.',
          },
          id: 'key-images-add',
          allowDuplicates: false,
        });

        await addPromise;
      } finally {
        keyImagesService.setAddingKeyImage(false);
        refreshAddKeyImageToolbar(servicesManager, activeViewportId);
      }
    },

    removeKeyImage: async ({ keyImageId }) => {
      const keyImage = keyImagesService.getKeyImages().find(item => item.id === keyImageId);
      if (!keyImage) {
        return;
      }

      const studyInstanceUID = keyImage.studyInstanceUID;
      const s3Key = keyImage.s3Key || keyImage.id;

      if (!studyInstanceUID || !s3Key) {
        keyImagesService.removeKeyImage(keyImageId);
        return;
      }

      const removePromise = (async () => {
        await deleteKeyImageFromRis(studyInstanceUID, s3Key);
        keyImagesService.removeKeyImage(keyImageId);
      })();

      uiNotificationService.show({
        title: 'Key Images',
        message: 'Removing key image...',
        promise: removePromise,
        promiseMessages: {
          loading: 'Removing key image...',
          success: 'Key image removed.',
          error: 'Failed to remove key image.',
        },
        id: `key-images-remove-${keyImageId}`,
        allowDuplicates: false,
      });

      await removePromise;
    },

    jumpToKeyImage: ({ keyImageId }) => {
      const keyImage = keyImagesService.getKeyImages().find(item => item.id === keyImageId);
      if (!keyImage) {
        return;
      }

      const activeViewportId = viewportGridService.getActiveViewportId();
      if (
        keyImage.imageIndex === undefined ||
        keyImage.imageIndex === null ||
        !Number.isFinite(keyImage.imageIndex)
      ) {
        uiNotificationService.show({
          title: 'Key Images',
          message: 'Jump is available for stack images only.',
          type: 'warning',
        });
        return;
      }

      commandsManager.run('jumpToImage', {
        imageIndex: keyImage.imageIndex,
        viewport: { id: activeViewportId },
      });
    },
  };

  const definitions = {
    loadKeyImages: {
      commandFn: actions.loadKeyImages,
    },
    addKeyImage: {
      commandFn: actions.addKeyImage,
    },
    removeKeyImage: {
      commandFn: actions.removeKeyImage,
    },
    jumpToKeyImage: {
      commandFn: actions.jumpToKeyImage,
    },
  };

  return {
    actions,
    definitions,
    defaultContext: 'CORNERSTONE',
  };
}

export default getCommandsModule;
