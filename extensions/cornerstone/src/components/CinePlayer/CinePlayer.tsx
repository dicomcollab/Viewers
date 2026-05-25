import React, { useCallback, useEffect, useState, useRef } from 'react';
import { useCine } from '@ohif/ui-next';
import { Enums, eventTarget, cache, metaData, getEnabledElement } from '@cornerstonejs/core';
import { useAppConfig } from '@state';
import { cineDebug, cineDebugWarn } from '../../utils/cineDebug';

function getPetFrameReferenceTimeFromImageId(imageId: string) {
  if (!imageId) {
    return null;
  }

  const instance = metaData.get('instance', imageId);
  let frameReferenceTime =
    instance?.FrameReferenceTime ?? metaData.get('petImageModule', imageId)?.frameReferenceTime;

  if (frameReferenceTime == null || frameReferenceTime === '') {
    return null;
  }

  const numeric = Number(frameReferenceTime);

  return Number.isFinite(numeric) ? numeric : null;
}

function buildPetCineDynamicInfo({
  cornerstoneViewportService,
  viewportId,
  displaySetService,
  viewportGridService,
}) {
  const { viewports } = viewportGridService.getState();
  const { displaySetInstanceUIDs = [] } = viewports.get(viewportId) || {};
  const displaySet = displaySetInstanceUIDs
    .map(uid => displaySetService.getDisplaySetByUID(uid))
    .find(ds => ds?.Modality === 'PT');

  if (!displaySet || (displaySet.numImageFrames ?? 0) <= 1) {
    return null;
  }

  const viewport = cornerstoneViewportService.getCornerstoneViewport(viewportId);
  const imageIds = viewport?.getImageIds?.() || [];
  const hasFrameReferenceTime = imageIds.some(
    imageId => getPetFrameReferenceTimeFromImageId(imageId) != null
  );

  if (!hasFrameReferenceTime) {
    return null;
  }

  const imageIndex = viewport?.getCurrentImageIdIndex?.() ?? 0;
  const frameReferenceTime = getPetFrameReferenceTimeFromImageId(imageIds[imageIndex]);

  return {
    viewportId,
    dimensionGroupNumber: imageIndex + 1,
    numDimensionGroups: imageIds.length,
    label: frameReferenceTime != null ? `FRT: ${frameReferenceTime} ms` : 'PET',
  };
}

function WrappedCinePlayer({
  enabledVPElement,
  viewportId,
  servicesManager,
}: withAppTypes<{
  enabledVPElement: HTMLElement;
  viewportId: string;
}>) {
  const { customizationService, displaySetService, viewportGridService, cornerstoneViewportService } =
    servicesManager.services;
  const [{ isCineEnabled, cines }, cineService] = useCine();
  const [newStackFrameRate, setNewStackFrameRate] = useState(24);
  const [dynamicInfo, setDynamicInfo] = useState(null);
  const [appConfig] = useAppConfig();

  const isMountedRef = useRef(false);
  const cinesRef = useRef(cines);
  const isCineEnabledRef = useRef(isCineEnabled);
  const cineServiceRef = useRef(cineService);
  const enabledVPElementRef = useRef(enabledVPElement);
  const lastPlaybackRef = useRef<{ isPlaying: boolean; frameRate: number } | null>(null);

  cinesRef.current = cines;
  isCineEnabledRef.current = isCineEnabled;
  cineServiceRef.current = cineService;
  enabledVPElementRef.current = enabledVPElement;

  const isPlaying = cines?.[viewportId]?.isPlaying ?? false;
  const frameRate = cines?.[viewportId]?.frameRate ?? 24;

  const applyPlayback = useCallback(
    (playing: boolean, fps: number) => {
      const element = enabledVPElementRef.current;
      const service = cineServiceRef.current;

      if (!element || !isMountedRef.current) {
        cineDebugWarn('CinePlayer', 'applyPlayback skipped — no element or not mounted', {
          viewportId,
          playing,
          fps,
          hasElement: !!element,
          mounted: isMountedRef.current,
        });
        return;
      }

      const validFrameRate = Math.max(fps, 1);
      const last = lastPlaybackRef.current;

      if (last?.isPlaying === playing && last?.frameRate === validFrameRate) {
        cineDebug('CinePlayer', 'applyPlayback skipped — unchanged', {
          viewportId,
          playing,
          fps: validFrameRate,
        });
        return;
      }

      lastPlaybackRef.current = { isPlaying: playing, frameRate: validFrameRate };

      const enabledElement = getEnabledElement(element);
      const viewport = enabledElement?.viewport;
      const imageIdCount =
        typeof viewport?.getImageIds === 'function' ? viewport.getImageIds()?.length ?? 0 : 0;
      const currentIndex =
        typeof viewport?.getCurrentImageIdIndex === 'function'
          ? viewport.getCurrentImageIdIndex()
          : null;

      if (playing) {
        cineDebug('CinePlayer', 'applyPlayback → playClip', {
          viewportId,
          fps: validFrameRate,
          hasEnabledElement: !!enabledElement,
          cornerstoneViewportId: viewport?.id,
          imageIdCount,
          currentIndex,
        });

        if (!enabledElement) {
          cineDebugWarn('CinePlayer', 'Cannot play — viewport element not enabled yet', { viewportId });
          return;
        }

        if (imageIdCount <= 1) {
          cineDebugWarn('CinePlayer', 'Cannot play — only one frame in stack', {
            viewportId,
            imageIdCount,
          });
          return;
        }

        service.playClip(element, { framesPerSecond: validFrameRate, viewportId });
      } else {
        cineDebug('CinePlayer', 'applyPlayback → stopClip', {
          viewportId,
          imageIdCount,
          currentIndex,
        });
        service.stopClip(element, { viewportId });
      }
    },
    [viewportId]
  );

  const newDisplaySetHandler = useCallback(() => {
    if (!enabledVPElementRef.current || !isCineEnabledRef.current) {
      return;
    }

    const { viewports } = viewportGridService.getState();
    const viewportState = viewports.get(viewportId);

    if (!viewportState?.displaySetInstanceUIDs?.length) {
      cineDebugWarn('CinePlayer', 'newDisplaySetHandler — no display sets', { viewportId });
      return;
    }

    const { displaySetInstanceUIDs } = viewportState;
    let nextFrameRate = 24;
    let nextIsPlaying = cinesRef.current[viewportId]?.isPlaying || false;

    displaySetInstanceUIDs.forEach(displaySetInstanceUID => {
      const displaySet = displaySetService.getDisplaySetByUID(displaySetInstanceUID);

      if (displaySet.FrameRate) {
        nextFrameRate = Math.round(1000 / displaySet.FrameRate);
        nextIsPlaying ||= !!appConfig.autoPlayCine;
      }

      if (displaySet.isDynamicVolume) {
        const { dynamicVolumeInfo } = displaySet;
        setDynamicInfo({
          volumeId: displaySet.displaySetInstanceUID,
          dimensionGroupNumber: dynamicVolumeInfo.dimensionGroupNumber || 1,
          numDimensionGroups: dynamicVolumeInfo.timePoints.length,
          label: dynamicVolumeInfo.splittingTag,
        });
      } else if (displaySet.Modality === 'PT') {
        setDynamicInfo(
          buildPetCineDynamicInfo({
            cornerstoneViewportService,
            viewportId,
            displaySetService,
            viewportGridService,
          })
        );
      } else {
        setDynamicInfo(null);
      }
    });

    cineDebug('CinePlayer', 'newDisplaySetHandler', {
      viewportId,
      nextFrameRate,
      nextIsPlaying,
    });

    if (nextIsPlaying) {
      cineServiceRef.current.setIsCineEnabled(true);
    }

    const currentCine = cinesRef.current[viewportId];

    if (currentCine?.frameRate !== nextFrameRate || currentCine?.isPlaying !== nextIsPlaying) {
      cineServiceRef.current.setCine({
        id: viewportId,
        isPlaying: nextIsPlaying,
        frameRate: nextFrameRate,
      });
    }

    setNewStackFrameRate(nextFrameRate);
  }, [
    appConfig.autoPlayCine,
    cornerstoneViewportService,
    displaySetService,
    viewportGridService,
    viewportId,
  ]);

  const newDisplaySetHandlerRef = useRef(newDisplaySetHandler);
  newDisplaySetHandlerRef.current = newDisplaySetHandler;

  useEffect(() => {
    isMountedRef.current = true;
    cineDebug('CinePlayer', 'mounted', { viewportId });
    newDisplaySetHandler();

    return () => {
      isMountedRef.current = false;
      lastPlaybackRef.current = null;
      cineDebug('CinePlayer', 'unmounted', { viewportId });
    };
  }, [isCineEnabled, newDisplaySetHandler, viewportId]);

  useEffect(() => {
    if (!enabledVPElement) {
      return;
    }

    const handler = () => newDisplaySetHandlerRef.current();

    enabledVPElement.addEventListener(Enums.Events.VIEWPORT_NEW_IMAGE_SET, handler);
    enabledVPElement.addEventListener(Enums.Events.VOLUME_VIEWPORT_NEW_VOLUME, handler);

    return () => {
      enabledVPElement.removeEventListener(Enums.Events.VIEWPORT_NEW_IMAGE_SET, handler);
      enabledVPElement.removeEventListener(Enums.Events.VOLUME_VIEWPORT_NEW_VOLUME, handler);
    };
  }, [enabledVPElement]);

  useEffect(() => {
    if (!isCineEnabled) {
      if (lastPlaybackRef.current?.isPlaying) {
        applyPlayback(false, frameRate);
      }
      lastPlaybackRef.current = null;
      return;
    }

    applyPlayback(isPlaying, frameRate);
  }, [isCineEnabled, isPlaying, frameRate, applyPlayback]);

  useEffect(() => {
    if (!enabledVPElement) {
      return;
    }

    const onStackNewImage = () => {
      setDynamicInfo(prev => {
        if (prev?.volumeId) {
          return prev;
        }

        return buildPetCineDynamicInfo({
          cornerstoneViewportService,
          viewportId,
          displaySetService,
          viewportGridService,
        });
      });
    };

    enabledVPElement.addEventListener(Enums.Events.STACK_NEW_IMAGE, onStackNewImage);

    return () => {
      enabledVPElement.removeEventListener(Enums.Events.STACK_NEW_IMAGE, onStackNewImage);
    };
  }, [cornerstoneViewportService, displaySetService, enabledVPElement, viewportGridService, viewportId]);

  useEffect(() => {
    return () => {
      const element = enabledVPElementRef.current;

      if (element) {
        cineDebug('CinePlayer', 'cleanup stopClip on unmount', { viewportId });
        cineServiceRef.current.stopClip(element, { viewportId });
        lastPlaybackRef.current = null;
      }
    };
  }, [viewportId]);

  if (!isCineEnabled) {
    return null;
  }

  return (
    <RenderCinePlayer
      viewportId={viewportId}
      cineService={cineService}
      newStackFrameRate={newStackFrameRate}
      isPlaying={isPlaying}
      dynamicInfo={dynamicInfo}
      customizationService={customizationService}
      cornerstoneViewportService={cornerstoneViewportService}
    />
  );
}

function RenderCinePlayer({
  viewportId,
  cineService,
  newStackFrameRate,
  isPlaying,
  dynamicInfo: dynamicInfoProp,
  customizationService,
  cornerstoneViewportService,
}) {
  const CinePlayerComponent = customizationService.getCustomization('cinePlayer');

  const [dynamicInfo, setDynamicInfo] = useState(dynamicInfoProp);

  useEffect(() => {
    setDynamicInfo(dynamicInfoProp);
  }, [dynamicInfoProp]);

  useEffect(() => {
    if (!dynamicInfo?.volumeId) {
      return;
    }

    const handleDimensionGroupChange = evt => {
      const { volumeId, dimensionGroupNumber, numDimensionGroups, splittingTag } = evt.detail;
      setDynamicInfo({ volumeId, dimensionGroupNumber, numDimensionGroups, label: splittingTag });
    };

    eventTarget.addEventListener(
      Enums.Events.DYNAMIC_VOLUME_DIMENSION_GROUP_CHANGED,
      handleDimensionGroupChange
    );

    return () => {
      eventTarget.removeEventListener(
        Enums.Events.DYNAMIC_VOLUME_DIMENSION_GROUP_CHANGED,
        handleDimensionGroupChange
      );
    };
  }, [dynamicInfo?.volumeId]);

  useEffect(() => {
    if (!dynamicInfo?.volumeId) {
      return;
    }

    const { volumeId, dimensionGroupNumber, numDimensionGroups, splittingTag } = dynamicInfo;
    const volume = cache.getVolume(volumeId, true);

    if (volume) {
      volume.dimensionGroupNumber = dimensionGroupNumber;
    }

    setDynamicInfo({ volumeId, dimensionGroupNumber, numDimensionGroups, label: splittingTag });
  }, [dynamicInfo?.volumeId]);

  const updateDynamicInfo = useCallback(
    props => {
      const { volumeId, dimensionGroupNumber, viewportId: petViewportId } = props;

      if (volumeId) {
        const volume = cache.getVolume(volumeId, true);

        if (volume) {
          volume.dimensionGroupNumber = dimensionGroupNumber;
        }
        return;
      }

      if (petViewportId) {
        cineDebug('CinePlayer', 'PET frame scrub', { petViewportId, dimensionGroupNumber });

        const viewport = cornerstoneViewportService.getCornerstoneViewport(petViewportId);
        const { isCineEnabled } = cineService.getState();

        if (isCineEnabled) {
          cineService.setCine({ id: petViewportId, isPlaying: false });
        }

        viewport?.setImageIdIndex?.(dimensionGroupNumber - 1);
      }
    },
    [cornerstoneViewportService, cineService]
  );

  return (
    <CinePlayerComponent
      className="absolute left-1/2 bottom-3 -translate-x-1/2"
      frameRate={newStackFrameRate}
      isPlaying={isPlaying}
      onClose={() => {
        cineDebug('CinePlayer', 'onClose', { viewportId });
        cineService.setCine({
          id: viewportId,
          isPlaying: false,
        });
        cineService.setIsCineEnabled(false);
        cineService.setViewportCineClosed(viewportId);
      }}
      onPlayPauseChange={playing => {
        cineDebug('CinePlayer', 'onPlayPauseChange', { viewportId, playing });
        cineService.setCine({
          id: viewportId,
          isPlaying: playing,
        });
      }}
      onFrameRateChange={nextFrameRate => {
        cineDebug('CinePlayer', 'onFrameRateChange', { viewportId, nextFrameRate });
        cineService.setCine({
          id: viewportId,
          frameRate: nextFrameRate,
        });
      }}
      dynamicInfo={dynamicInfo}
      updateDynamicInfo={updateDynamicInfo}
    />
  );
}

export default WrappedCinePlayer;
