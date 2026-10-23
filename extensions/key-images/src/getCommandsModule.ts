import { getActiveStudyInstanceUID } from './utils/getActiveStudyInstanceUID';
import { getKeyImagesAuthHeader } from './utils/getKeyImagesAuthHeader';
import { deleteKeyImageFromRis, uploadKeyImagesToRis } from './utils/keyImagesApi';
import { captureKeyImage } from './utils/captureKeyImage';
import {
  resolveKeyImageNavigationTarget,
  resolveKeyImageViewportContext,
} from './utils/resolveKeyImageViewportContext';

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
    hangingProtocolService,
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

      const context = resolveKeyImageViewportContext({
        servicesManager,
        activeViewportId,
        viewport,
      });

      const {
        imageId,
        imageIndex,
        studyInstanceUID,
        seriesInstanceUID,
        sopInstanceUID,
        frameNumber,
      } = context;

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
        sopInstanceUID,
        frameNumber,
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
            (sopInstanceUID && m.SOPInstanceUID === sopInstanceUID)
        );

        const pendingKeyImage = {
          id: `key-image-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          imageId,
          imageIndex,
          viewportId: activeViewportId,
          studyInstanceUID,
          seriesInstanceUID,
          sopInstanceUID,
          frameNumber,
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
      if (!activeViewportId) {
        return;
      }

      const { displaySet, imageIndex, referencedImageId } = resolveKeyImageNavigationTarget({
        servicesManager,
        keyImage,
      });

      const resolvedImageIndex =
        imageIndex !== undefined && imageIndex !== null && Number.isFinite(imageIndex)
          ? imageIndex
          : keyImage.imageIndex;

      if (
        resolvedImageIndex === undefined ||
        resolvedImageIndex === null ||
        !Number.isFinite(resolvedImageIndex)
      ) {
        uiNotificationService.show({
          title: 'Key Images',
          message: 'Jump is available for stack images only.',
          type: 'warning',
        });
        return;
      }

      const jumpToResolvedImage = () => {
        try {
          commandsManager.run('jumpToImage', {
            imageIndex: resolvedImageIndex,
            viewport: { id: activeViewportId },
          });
          return true;
        } catch {
          return false;
        }
      };

      // If series/SOP metadata cannot be matched, still jump within the current
      // stack when an image index is available (same-series Go To).
      if (!displaySet) {
        if (jumpToResolvedImage()) {
          return;
        }
        uiNotificationService.show({
          title: 'Key Images',
          message: 'Could not find the series for this key image in the current study.',
          type: 'warning',
        });
        return;
      }

      const displaySetInstanceUID = displaySet.displaySetInstanceUID || displaySet.uid;
      const currentDisplaySetUIDs =
        viewportGridService.getDisplaySetsUIDsForViewport(activeViewportId) || [];
      const needsSeriesSwitch = !currentDisplaySetUIDs.includes(displaySetInstanceUID);

      if (needsSeriesSwitch) {
        if (referencedImageId) {
          commandsManager.run('updateStoredPositionPresentation', {
            viewportId: activeViewportId,
            displaySetInstanceUIDs: [displaySetInstanceUID],
            referencedImageId,
          });
        }

        let viewportsToUpdate =
          hangingProtocolService?.getViewportsRequireUpdate?.(
            activeViewportId,
            displaySetInstanceUID
          ) || [];

        if (!viewportsToUpdate?.length) {
          viewportsToUpdate = [
            {
              viewportId: activeViewportId,
              displaySetInstanceUIDs: [displaySetInstanceUID],
            },
          ];
        }

        commandsManager.run('setDisplaySetsForViewports', { viewportsToUpdate });

        // Stack bind is async after series switch. Do not jump immediately —
        // the old stack may still be active and would make jumpToImage "succeed"
        // on the wrong series. Retry until the target display set is loaded.
        let attempts = 0;
        const maxAttempts = 12;
        const retry = () => {
          attempts += 1;
          const loadedUIDs =
            viewportGridService.getDisplaySetsUIDsForViewport(activeViewportId) || [];
          const seriesReady = loadedUIDs.includes(displaySetInstanceUID);
          if (seriesReady && jumpToResolvedImage()) {
            return;
          }
          if (attempts >= maxAttempts) {
            return;
          }
          window.setTimeout(retry, 75);
        };
        window.setTimeout(retry, 50);

        return;
      }

      jumpToResolvedImage();
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
