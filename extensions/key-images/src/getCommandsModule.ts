import { DicomMetadataStore } from '@ohif/core';
import { captureViewportImage } from '@ohif/extension-cornerstone';
import { getActiveStudyInstanceUID } from './utils/getActiveStudyInstanceUID';
import { getKeyImagesAuthHeader } from './utils/getKeyImagesAuthHeader';

function refreshAddKeyImageToolbar(servicesManager, viewportId?: string) {
  const { toolbarService } = servicesManager.services;
  toolbarService?.refreshToolbarState?.({
    viewportId,
    itemId: 'AddKeyImage',
  });
}

function getCommandsModule({ servicesManager, commandsManager }) {
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

      const imageId =
        typeof viewport.getCurrentImageId === 'function' ? viewport.getCurrentImageId() : undefined;
      const imageIds = typeof viewport.getImageIds === 'function' ? viewport.getImageIds() : [];
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
        const { dataUrl, blob } = await captureViewportImage({
          activeViewportId,
          cornerstoneViewportService,
          showAnnotations: true,
          fileType: 'png',
        });

        const measurements = measurementService.getMeasurements(
          m =>
            (imageId && m.referencedImageId === imageId) ||
            (instance?.SOPInstanceUID && m.SOPInstanceUID === instance.SOPInstanceUID)
        );

        keyImagesService.addKeyImage({
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
        });
      })();

      try {
        uiNotificationService.show({
          title: 'Key Images',
          message: 'Adding key image...',
          promise: addPromise,
          promiseMessages: {
            loading: 'Adding key image...',
            success: 'Current image added to Key Images.',
            error: 'Failed to add key image.',
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

    removeKeyImage: ({ keyImageId }) => {
      keyImagesService.removeKeyImage(keyImageId);
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

    saveKeyImages: async () => {
      const activeStudyUID = getActiveStudyInstanceUID(servicesManager);
      const keyImages = activeStudyUID
        ? keyImagesService.getKeyImagesForStudy(activeStudyUID)
        : [];

      if (!activeStudyUID) {
        uiNotificationService.show({
          title: 'Key Images',
          message: 'No active study selected. Open a study before saving key images.',
          type: 'warning',
        });
        return;
      }

      if (!keyImages.length) {
        uiNotificationService.show({
          title: 'Key Images',
          message: 'No key images to save for the current study.',
          type: 'warning',
        });
        return;
      }

      const keyImagesUploadUrl = window.config?.keyImagesUploadUrl;
      if (!keyImagesUploadUrl) {
        uiNotificationService.show({
          title: 'Key Images',
          message: 'Missing keyImagesUploadUrl in config.',
          type: 'error',
        });
        return;
      }

      const appConfig =
        typeof window !== 'undefined'
          ? (window.config as Parameters<typeof getKeyImagesAuthHeader>[0])
          : undefined;
      const authHeaders = getKeyImagesAuthHeader(appConfig);

      if (!authHeaders?.Authorization) {
        uiNotificationService.show({
          title: 'Key Images',
          message:
            'Missing API credentials. Set keyImagesBasicAuthToken or keyImagesAuthorization in app config.',
          type: 'error',
        });
        return;
      }

      const metadata = {
        createdAt: new Date().toISOString(),
        studyInstanceUID: activeStudyUID,
        reportContextId: new URLSearchParams(window.location.search).get('reportContextId') || null,
        tempId: new URLSearchParams(window.location.search).get('tempId') || null,
        keyImages: keyImages.map(item => ({
          id: item.id,
          imageId: item.imageId,
          imageIndex: item.imageIndex,
          studyInstanceUID: item.studyInstanceUID,
          seriesInstanceUID: item.seriesInstanceUID,
          sopInstanceUID: item.sopInstanceUID,
          frameNumber: item.frameNumber,
          createdAt: item.createdAt,
          measurements: item.measurements || [],
        })),
      };

      const formData = new FormData();
      formData.append('metadata', JSON.stringify(metadata));

      for (let i = 0; i < keyImages.length; i++) {
        const item = keyImages[i];
        let fileBlob = item.blob;
        if (!fileBlob && item.dataUrl) {
          const response = await fetch(item.dataUrl);
          fileBlob = await response.blob();
        }

        if (fileBlob) {
          formData.append('files', fileBlob, `${item.id}.png`);
        }
      }

      const response = await fetch(keyImagesUploadUrl, {
        method: 'POST',
        headers: authHeaders,
        body: formData,
      });

      if (!response.ok) {
        let detail = '';
        try {
          detail = await response.text();
        } catch {
          /* ignore */
        }
        throw new Error(
          `Upload failed with status ${response.status}${detail ? `: ${detail}` : ''}`
        );
      }

      keyImagesService.clearKeyImagesForStudy(activeStudyUID);

      uiNotificationService.show({
        title: 'Key Images',
        message: 'Key images saved successfully.',
        type: 'success',
      });
    },
  };

  const definitions = {
    addKeyImage: {
      commandFn: actions.addKeyImage,
    },
    removeKeyImage: {
      commandFn: actions.removeKeyImage,
    },
    jumpToKeyImage: {
      commandFn: actions.jumpToKeyImage,
    },
    saveKeyImages: {
      commandFn: actions.saveKeyImages,
    },
  };

  return {
    actions,
    definitions,
    defaultContext: 'CORNERSTONE',
  };
}

export default getCommandsModule;
