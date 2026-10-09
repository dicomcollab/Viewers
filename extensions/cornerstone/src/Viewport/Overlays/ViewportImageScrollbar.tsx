import React, { useEffect } from 'react';
import PropTypes from 'prop-types';
import { Enums, VolumeViewport3D } from '@cornerstonejs/core';
import { ImageScrollbar } from '@ohif/ui-next';
import { restartPlayingCineClips } from '../../utils/usCinePlaybackUtils';
import { rememberUsViewportFrame } from '../../utils/usInstanceFrameState';
import { getAliveViewport, setViewportFrameIndex } from '../../utils/safeViewportFrameUtils';
import { getCinePlayhead, subscribeCinePlayhead } from '../../utils/cinePlayheadStore';

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

  const setSliceData = (imageIndex: number, numberOfSlices: number) => {
    const index = Number.isFinite(imageIndex) ? imageIndex : 0;
    const total = Number.isFinite(numberOfSlices) && numberOfSlices > 0 ? numberOfSlices : 1;
    setImageSliceData(prev =>
      prev?.imageIndex === index && prev?.numberOfSlices === total
        ? prev
        : { imageIndex: index, numberOfSlices: total }
    );
  };

  const onImageScrollbarChange = (imageIndex, viewportId) => {
    const viewport = getAliveViewport(cornerstoneViewportService, viewportId);

    if (!viewport) {
      return;
    }

    const wasPlaying = Boolean(cineService.getState().cines?.[viewportId]?.isPlaying);

    setViewportFrameIndex(viewport, imageIndex);
    rememberUsViewportFrame(servicesManager, viewportId, imageIndex);

    if (wasPlaying) {
      restartPlayingCineClips(servicesManager, [viewportId]);
    }
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
        // During cine the timeline owns the counter; a frame swap finishing
        // late must not pull it back to an older frame.
        const playhead = getCinePlayhead(viewportId);
        if (playhead) {
          setSliceData(playhead.index, playhead.total);
          return;
        }
        const { imageIndex, newImageIdIndex = imageIndex, imageIdIndex } = event.detail || {};
        const rawIndex = newImageIdIndex ?? imageIdIndex ?? imageIndex;
        const safeIndex = typeof rawIndex === 'number' && Number.isFinite(rawIndex) ? rawIndex : 0;
        let numberOfSlices = 1;
        try {
          numberOfSlices = viewport.getNumberOfSlices?.() ?? 1;
        } catch {
          numberOfSlices = 1;
        }
        setSliceData(safeIndex, numberOfSlices);
      } catch {
        // viewport may have undefined volume id after orientation change
      }
    };

    element.addEventListener(eventId, updateIndex);

    return () => {
      element.removeEventListener(eventId, updateIndex);
    };
  }, [viewportData, element]);

  // The counter shows the cine timeline frame, same as the cine bar: frames
  // still downloading are shown empty and fire no STACK_NEW_IMAGE. When cine
  // stops, fall back to the frame the viewport actually shows.
  useEffect(() => {
    return subscribeCinePlayhead((id, playhead) => {
      if (id !== viewportId) {
        return;
      }

      if (playhead) {
        setSliceData(playhead.index, playhead.total);
        return;
      }

      const viewport = getAliveViewport(cornerstoneViewportService, viewportId);
      if (!viewport || typeof viewport.getCurrentImageIdIndex !== 'function') {
        return;
      }
      try {
        setSliceData(viewport.getCurrentImageIdIndex(), viewport.getNumberOfSlices?.() ?? 1);
      } catch {
        // Viewport torn down by a layout change.
      }
    });
  }, [viewportId, setImageSliceData, cornerstoneViewportService]);

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
