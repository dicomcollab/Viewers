import React, { useEffect } from 'react';
import PropTypes from 'prop-types';
import { Enums, VolumeViewport3D, utilities as csUtils } from '@cornerstonejs/core';
import { ImageScrollbar } from '@ohif/ui-next';

function CornerstoneImageScrollbar({
  viewportData,
  viewportId,
  element,
  imageSliceData,
  setImageSliceData,
  scrollbarHeight,
  servicesManager,
}: withAppTypes<{
  element: HTMLElement;
}>) {
  const { cineService, cornerstoneViewportService } = servicesManager.services;

  const onImageScrollbarChange = (imageIndex, viewportId) => {
    const viewport = cornerstoneViewportService.getCornerstoneViewport(viewportId);

    const { isCineEnabled } = cineService.getState();

    if (isCineEnabled) {
      // on image scrollbar change, stop the CINE if it is playing
      cineService.stopClip(element, { viewportId });
      cineService.setCine({ id: viewportId, isPlaying: false });
    }

    csUtils.jumpToSlice(viewport.element, {
      imageIndex,
      debounceLoading: true,
    });
  };

  useEffect(() => {
    if (!viewportData) {
      return;
    }

    const viewport = cornerstoneViewportService.getCornerstoneViewport(viewportId);

    if (!viewport || viewport instanceof VolumeViewport3D) {
      return;
    }

    // After orientation change or during viewport setup, volume id can be undefined;
    // getCurrentImageIdIndex() throws "Could not find image volume with id undefined".
    const volumeId = typeof viewport.getVolumeId === 'function' ? viewport.getVolumeId() : undefined;
    if (volumeId == null && viewportData.viewportType === Enums.ViewportType.ORTHOGRAPHIC) {
      setImageSliceData(prev => ({ imageIndex: prev?.imageIndex ?? 0, numberOfSlices: prev?.numberOfSlices ?? 1 }));
      return;
    }

    try {
      const rawIndex =
        typeof viewport.getCurrentImageIdIndex === 'function'
          ? viewport.getCurrentImageIdIndex(volumeId)
          : 0;
      const imageIndex =
        typeof rawIndex === 'number' && Number.isFinite(rawIndex) ? rawIndex : 0;
      let numberOfSlices = 1;
      try {
        numberOfSlices = viewport.getNumberOfSlices?.() ?? 1;
      } catch {
        numberOfSlices = 1;
      }

      setImageSliceData({
        imageIndex,
        numberOfSlices,
      });
    } catch {
      setImageSliceData(prev => ({ imageIndex: prev?.imageIndex ?? 0, numberOfSlices: prev?.numberOfSlices ?? 1 }));
    }
  }, [viewportId, viewportData]);

  useEffect(() => {
    if (!viewportData) {
      return;
    }
    const { viewportType } = viewportData;
    const eventId =
      (viewportType === Enums.ViewportType.STACK && Enums.Events.STACK_NEW_IMAGE) ||
      (viewportType === Enums.ViewportType.ORTHOGRAPHIC && Enums.Events.VOLUME_NEW_IMAGE) ||
      Enums.Events.IMAGE_RENDERED;

    const updateIndex = event => {
      const viewport = cornerstoneViewportService.getCornerstoneViewport(viewportId);
      if (!viewport || viewport instanceof VolumeViewport3D) {
        return;
      }
      try {
        const { imageIndex, newImageIdIndex = imageIndex, imageIdIndex } = event.detail || {};
        const rawIndex = newImageIdIndex ?? imageIdIndex ?? imageIndex;
        const safeIndex = typeof rawIndex === 'number' && Number.isFinite(rawIndex) ? rawIndex : 0;
        let numberOfSlices = 1;
        try {
          numberOfSlices = viewport.getNumberOfSlices?.() ?? 1;
        } catch {
          numberOfSlices = 1;
        }
        setImageSliceData({
          imageIndex: safeIndex,
          numberOfSlices,
        });
      } catch {
        // viewport may have undefined volume id after orientation change
      }
    };

    element.addEventListener(eventId, updateIndex);

    return () => {
      element.removeEventListener(eventId, updateIndex);
    };
  }, [viewportData, element]);

  return (
    <ImageScrollbar
      onChange={evt => onImageScrollbarChange(evt, viewportId)}
      max={imageSliceData.numberOfSlices ? imageSliceData.numberOfSlices - 1 : 0}
      height={scrollbarHeight}
      value={imageSliceData.imageIndex || 0}
    />
  );
}

CornerstoneImageScrollbar.propTypes = {
  viewportData: PropTypes.object,
  viewportId: PropTypes.string.isRequired,
  element: PropTypes.instanceOf(Element),
  scrollbarHeight: PropTypes.string,
  imageSliceData: PropTypes.object.isRequired,
  setImageSliceData: PropTypes.func.isRequired,
  servicesManager: PropTypes.object.isRequired,
};

export default CornerstoneImageScrollbar;
