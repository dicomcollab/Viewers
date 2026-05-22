import { DicomMetadataStore, classes } from '@ohif/core';
import { calculateSUVScalingFactors } from '@cornerstonejs/calculate-suv';

import getPTImageIdInstanceMetadata from './getPTImageIdInstanceMetadata';
import getRelatedImageIds, { isJpegRenderedImageId } from './utils/getRelatedImageIds';
import { registerHangingProtocolAttributes } from './hangingprotocols';
import { HotkeysManager } from '@ohif/core';

// Import image cache module to ensure it initializes early
// This sets up window.__OHIF_IMAGE_CACHE__ before image loading starts
import './DicomWebDataSource/utils/imageCache.js';

const metadataProvider = classes.MetadataProvider;

/**
 *
 * @param {Object} servicesManager
 * @param {Object} configuration
 */
export default function init({
  servicesManager,
  commandsManager,
  hotkeysManager,
}: withAppTypes): void {
  const { toolbarService, cineService, viewportGridService } = servicesManager.services;

  toolbarService.registerEventForToolbarUpdate(cineService, [
    cineService.EVENTS.CINE_STATE_CHANGED,
  ]);

  toolbarService.registerEventForToolbarUpdate(hotkeysManager, [
    HotkeysManager.EVENTS.HOTKEY_PRESSED,
  ]);

  // Add
  DicomMetadataStore.subscribe(DicomMetadataStore.EVENTS.INSTANCES_ADDED, handleScalingModules);

  // If the metadata for PET has changed by the user (e.g. manually changing the PatientWeight)
  // we need to recalculate the SUV Scaling Factors
  DicomMetadataStore.subscribe(DicomMetadataStore.EVENTS.SERIES_UPDATED, handleScalingModules);

  // Adds extra custom attributes for use by hanging protocols
  registerHangingProtocolAttributes({ servicesManager });

  // Function to process and subscribe to events for a given set of commands and listeners
  const eventSubscriptions = [];
  const subscribeToEvents = listeners => {
    Object.entries(listeners).forEach(([event, commands]) => {
      const supportedEvents = [
        viewportGridService.EVENTS.ACTIVE_VIEWPORT_ID_CHANGED,
        viewportGridService.EVENTS.VIEWPORTS_READY,
      ];

      if (supportedEvents.includes(event)) {
        const subscriptionKey = `${event}_${JSON.stringify(commands)}`;

        if (eventSubscriptions.includes(subscriptionKey)) {
          return;
        }

        viewportGridService.subscribe(event, eventData => {
          const viewportId = eventData?.viewportId ?? viewportGridService.getActiveViewportId();

          commandsManager.run(commands, { viewportId });
        });

        eventSubscriptions.push(subscriptionKey);
      }
    });
  };

  toolbarService.subscribe(toolbarService.EVENTS.TOOL_BAR_MODIFIED, state => {
    const { buttons } = state;
    for (const [id, button] of Object.entries(buttons)) {
      const { buttonSection, items, listeners } = button.props || {};

      // Handle group items' listeners
      if (buttonSection && items) {
        items.forEach(item => {
          if (item.listeners) {
            subscribeToEvents(item.listeners);
          }
        });
      }

      // Handle button listeners
      if (listeners) {
        subscribeToEvents(listeners);
      }
    }
  });
}

const handleScalingModules = ({ SeriesInstanceUID, StudyInstanceUID }) => {
  const { instances } = DicomMetadataStore.getSeries(StudyInstanceUID, SeriesInstanceUID);

  if (!instances?.length) {
    return;
  }

  const modality = instances[0].Modality;

  const allowedModality = ['PT', 'RTDOSE'];

  if (!allowedModality.includes(modality)) {
    return;
  }

  const imageIds = instances.flatMap(instance => getRelatedImageIds(instance));

  if (modality === 'RTDOSE') {
    const DoseGridScaling = instances[0].DoseGridScaling;
    const DoseSummation = instances[0].DoseSummation;
    const DoseType = instances[0].DoseType;
    const DoseUnit = instances[0].DoseUnit;
    const NumberOfFrames = instances[0].NumberOfFrames;
    const imageId = imageIds[0];

    // add scaling module to the metadata
    // since RTDOSE is always a multiframe we should add the scaling module to each frame
    for (let i = 0; i < NumberOfFrames; i++) {
      const frameIndex = i + 1;

      // Todo: we should support other things like wadouri, local etc
      const newImageId = `${imageId.replace(/\/frames\/\d+$/, '')}/frames/${frameIndex}`;
      metadataProvider.addCustomMetadata(newImageId, 'scalingModule', {
        DoseGridScaling,
        DoseSummation,
        DoseType,
        DoseUnit,
      });
    }

    return;
  }

  const defaultScaling = { scaled: false };

  // Ensure PT images always have a scalingModule object so downstream GPU paths
  // (e.g. isPTPrescaledWithSUV) never read `.scaled` from undefined.
  imageIds.forEach(imageId => {
    metadataProvider.addCustomMetadata(imageId, 'scalingModule', defaultScaling);
  });

  // JPEG WADO-URI renders do not carry SUV tags; skip SUV calculation (no console noise).
  const instancesByBaseImageId = new Map(instances.map(instance => [instance.imageId, instance]));

  const imageIdMetadataPairs = [];
  instances.forEach(instance => {
    const baseImageId = instance.imageId;
    if (!baseImageId || isJpegRenderedImageId(baseImageId)) {
      return;
    }

    try {
      const instanceMetadata = getPTImageIdInstanceMetadata(baseImageId);
      if (instanceMetadata) {
        imageIdMetadataPairs.push({ imageId: baseImageId, instanceMetadata, instance });
      }
    } catch {
      // scaled:false already applied to base + frame imageIds above
    }
  });

  if (!imageIdMetadataPairs.length) {
    return;
  }

  try {
    const suvScalingFactors = calculateSUVScalingFactors(
      imageIdMetadataPairs.map(pair => pair.instanceMetadata)
    );

    imageIdMetadataPairs.forEach((pair, index) => {
      const raw = suvScalingFactors[index];
      const scalingFactor = {
        scaled: false,
        ...(typeof raw === 'object' && raw ? raw : {}),
      };
      if (scalingFactor.suvbw != null) {
        scalingFactor.scaled = true;
      }
      const relatedIds = getRelatedImageIds(
        pair.instance || instancesByBaseImageId.get(pair.imageId)
      );
      relatedIds.forEach(imageId => {
        metadataProvider.addCustomMetadata(imageId, 'scalingModule', scalingFactor);
      });
    });
  } catch {
    // scaled:false fallback already applied
  }
};
