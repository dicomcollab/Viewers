import React, { useCallback, useEffect, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useCine } from '@ohif/ui-next';
import { Enums, eventTarget, cache, metaData, getEnabledElement } from '@cornerstonejs/core';
import { useAppConfig } from '@state';
import { cineDebug, cineDebugWarn } from '../../utils/cineDebug';
import {
  getCineControlViewportId,
  getCineDisplaySetFromViewport,
  isMultiframeStackDisplaySet,
  isMultiSeriesInstanceLayout,
  isUsMultiframeDisplaySet,
  shouldUsePerViewportCine,
  shouldUseUnifiedCineControl,
  viewportSupportsCine,
} from '../../utils/cineSyncUtils';
import UsViewportCineBar from './UsViewportCineBar';
import { advanceUsBatch } from '../../utils/usBatchNavigationUtils';
import { getSharedStudyCineSettings } from '../../utils/usCinePlaybackUtils';
import { getUsCineCapableLayoutViewportIds } from '../../utils/usGridViewportUtils';
import {
  buildUsStackCineInfo,
  getUsCineFrameRate,
  DEFAULT_US_FRAME_STEP,
} from '../../utils/usStackCineUtils';
import {
  getCinePreferences,
  getDefaultCinePlayMode,
  shouldAutoPlayCine,
} from '../../utils/cinePreferencesUtils';

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
  const {
    customizationService,
    displaySetService,
    viewportGridService,
    cornerstoneViewportService,
  } = servicesManager.services;
  const [{ isCineEnabled, cines }, cineService] = useCine();
  const [newStackFrameRate, setNewStackFrameRate] = useState(24);
  const [dynamicInfo, setDynamicInfo] = useState(null);
  const [stackCineInfo, setStackCineInfo] = useState(null);
  const [appConfig] = useAppConfig();

  const isMountedRef = useRef(false);
  const cinesRef = useRef(cines);
  const isCineEnabledRef = useRef(isCineEnabled);
  const cineServiceRef = useRef(cineService);
  const enabledVPElementRef = useRef(enabledVPElement);
  const lastPlaybackRef = useRef<{
    isPlaying: boolean;
    frameRate: number;
    cinePlayMode?: 'fps' | 'step';
    frameStep?: number;
  } | null>(null);

  cinesRef.current = cines;
  isCineEnabledRef.current = isCineEnabled;
  cineServiceRef.current = cineService;
  enabledVPElementRef.current = enabledVPElement;

  const isPlaying = cines?.[viewportId]?.isPlaying ?? false;
  const frameRate = cines?.[viewportId]?.frameRate ?? 24;
  const cinePlayMode = cines?.[viewportId]?.cinePlayMode ?? 'fps';
  const frameStep = cines?.[viewportId]?.frameStep ?? DEFAULT_US_FRAME_STEP;

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

      if (
        last?.isPlaying === playing &&
        last?.frameRate === validFrameRate &&
        last?.cinePlayMode === cinePlayMode &&
        last?.frameStep === frameStep
      ) {
        cineDebug('CinePlayer', 'applyPlayback skipped — unchanged', {
          viewportId,
          playing,
          fps: validFrameRate,
        });
        return;
      }

      lastPlaybackRef.current = {
        isPlaying: playing,
        frameRate: validFrameRate,
        cinePlayMode,
        frameStep,
      };

      const enabledElement = getEnabledElement(element);
      const viewport = enabledElement?.viewport;
      const imageIdCount =
        typeof viewport?.getImageIds === 'function' ? (viewport.getImageIds()?.length ?? 0) : 0;
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
          cineDebugWarn('CinePlayer', 'Cannot play — viewport element not enabled yet', {
            viewportId,
          });
          return;
        }

        if (imageIdCount <= 1) {
          cineDebugWarn('CinePlayer', 'Cannot play — only one frame in stack', {
            viewportId,
            imageIdCount,
          });
          return;
        }

        service.playClip(element, {
          framesPerSecond: validFrameRate,
          viewportId,
          cinePlayMode,
          frameStep,
        });
      } else {
        cineDebug('CinePlayer', 'applyPlayback → stopClip', {
          viewportId,
          imageIdCount,
          currentIndex,
        });
        service.stopClip(element, { viewportId });
      }
    },
    [cinePlayMode, frameStep, viewportId]
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
    const cinePreferences = getCinePreferences();
    const defaultPlayMode = getDefaultCinePlayMode(cinePreferences);
    const autoPlayEnabled = shouldAutoPlayCine(cinePreferences, appConfig.autoPlayCine);
    let nextFrameRate = 24;
    let nextIsPlaying = cinesRef.current[viewportId]?.isPlaying || false;
    let nextCinePlayMode = cinesRef.current[viewportId]?.cinePlayMode ?? defaultPlayMode;
    let nextFrameStep = cinesRef.current[viewportId]?.frameStep ?? DEFAULT_US_FRAME_STEP;
    let nextStackCineInfo = null;
    const isMultiSeriesLayout = isMultiSeriesInstanceLayout(servicesManager);
    let sharedCineSettings = isMultiSeriesLayout
      ? getSharedStudyCineSettings(servicesManager)
      : null;

    // First load of a multi-series grid: seed one shared rate from the first tile.
    // Default play mode is FPS using machine FrameTime (doctors usually need this).
    if (isMultiSeriesLayout && !sharedCineSettings) {
      const layoutViewportIds = getUsCineCapableLayoutViewportIds(servicesManager);
      const { viewports: layoutViewports } = viewportGridService.getState();
      const referenceDisplaySet = getCineDisplaySetFromViewport(
        displaySetService,
        layoutViewports.get(layoutViewportIds[0])
      );

      if (referenceDisplaySet) {
        sharedCineSettings = {
          frameRate: getUsCineFrameRate(referenceDisplaySet),
          cinePlayMode: defaultPlayMode,
          frameStep: DEFAULT_US_FRAME_STEP,
        };
      }
    }

    const resolveMultiframeRate = (displaySet) => {
      // Keep one shared FPS/fr across US 1×4 (and similar) so paging does not
      // re-derive mismatched rates from each series' FrameTime.
      if (sharedCineSettings) {
        return {
          frameRate: sharedCineSettings.frameRate,
          cinePlayMode: sharedCineSettings.cinePlayMode,
          frameStep: sharedCineSettings.frameStep,
        };
      }

      const existing = cinesRef.current[viewportId];

      return {
        frameRate: getUsCineFrameRate(displaySet),
        cinePlayMode: existing?.cinePlayMode ?? defaultPlayMode,
        frameStep: existing?.frameStep ?? DEFAULT_US_FRAME_STEP,
      };
    };

    displaySetInstanceUIDs.forEach(displaySetInstanceUID => {
      const displaySet = displaySetService.getDisplaySetByUID(displaySetInstanceUID);

      if (displaySet.isDynamicVolume) {
        const { dynamicVolumeInfo } = displaySet;
        setDynamicInfo({
          volumeId: displaySet.displaySetInstanceUID,
          dimensionGroupNumber: dynamicVolumeInfo.dimensionGroupNumber || 1,
          numDimensionGroups: dynamicVolumeInfo.timePoints.length,
          label: dynamicVolumeInfo.splittingTag,
        });
        setStackCineInfo(null);
      } else if (displaySet.Modality === 'PT') {
        const petDynamicInfo = buildPetCineDynamicInfo({
          cornerstoneViewportService,
          viewportId,
          displaySetService,
          viewportGridService,
        });

        if (petDynamicInfo) {
          setDynamicInfo(petDynamicInfo);
          setStackCineInfo(null);
        } else if (isMultiframeStackDisplaySet(displaySet)) {
          setDynamicInfo(null);
          nextStackCineInfo = buildUsStackCineInfo({
            cornerstoneViewportService,
            viewportId,
            displaySetService,
            viewportGridService,
            servicesManager,
          });
          setStackCineInfo(nextStackCineInfo);
          const resolved = resolveMultiframeRate(displaySet);
          nextFrameRate = resolved.frameRate;
          nextCinePlayMode = resolved.cinePlayMode;
          nextFrameStep = resolved.frameStep;
        }
      } else if (isMultiframeStackDisplaySet(displaySet)) {
        setDynamicInfo(null);
        nextStackCineInfo = buildUsStackCineInfo({
          cornerstoneViewportService,
          viewportId,
          displaySetService,
          viewportGridService,
          servicesManager,
        });
        setStackCineInfo(nextStackCineInfo);
        const resolved = resolveMultiframeRate(displaySet);
        nextFrameRate = resolved.frameRate;
        nextCinePlayMode = resolved.cinePlayMode;
        nextFrameStep = resolved.frameStep;
        // Autoplay is US-only; other modalities require manual play.
        nextIsPlaying ||= autoPlayEnabled && isUsMultiframeDisplaySet(displaySet);
      } else if (displaySet.FrameRate) {
        nextFrameRate = Math.round(1000 / displaySet.FrameRate);
        nextIsPlaying ||= autoPlayEnabled && displaySet.Modality === 'US';
      } else {
        setDynamicInfo(null);
        setStackCineInfo(null);
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

    const shouldUpdateCine =
      currentCine?.frameRate !== nextFrameRate ||
      currentCine?.isPlaying !== nextIsPlaying ||
      currentCine?.cinePlayMode !== nextCinePlayMode ||
      currentCine?.frameStep !== nextFrameStep;

    if (shouldUpdateCine) {
      cineServiceRef.current.setCine({
        id: viewportId,
        isPlaying: nextIsPlaying,
        frameRate: nextFrameRate,
        cinePlayMode: nextCinePlayMode,
        frameStep: nextFrameStep,
      });
    }

    setNewStackFrameRate(nextFrameRate);
  }, [
    appConfig.autoPlayCine,
    cornerstoneViewportService,
    displaySetService,
    servicesManager,
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
  }, [isCineEnabled, isPlaying, frameRate, cinePlayMode, frameStep, applyPlayback]);

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

      setStackCineInfo(
        buildUsStackCineInfo({
          cornerstoneViewportService,
          viewportId,
          displaySetService,
          viewportGridService,
          servicesManager,
        })
      );
    };

    enabledVPElement.addEventListener(Enums.Events.STACK_NEW_IMAGE, onStackNewImage);

    return () => {
      enabledVPElement.removeEventListener(Enums.Events.STACK_NEW_IMAGE, onStackNewImage);
    };
  }, [
    cornerstoneViewportService,
    displaySetService,
    enabledVPElement,
    servicesManager,
    viewportGridService,
    viewportId,
  ]);

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

  const usePerViewportCine = shouldUsePerViewportCine(servicesManager);
  const cineControlViewportId = getCineControlViewportId(servicesManager);
  const { viewports } = viewportGridService.getState();
  const viewportState = viewports.get(viewportId);
  const supportsCine = viewportSupportsCine(displaySetService, viewportState);
  const showCineUI = usePerViewportCine
    ? supportsCine
    : cineControlViewportId === viewportId;

  if (!showCineUI) {
    return null;
  }

  if (!isCineEnabled && !usePerViewportCine) {
    return null;
  }

  const useUnifiedCineControl = shouldUseUnifiedCineControl(servicesManager);
  if (usePerViewportCine) {
    return (
      <>
        {stackCineInfo && (
          <UsViewportCineBar
            viewportId={viewportId}
            servicesManager={servicesManager}
            isPlaying={isPlaying}
            stackCineInfo={stackCineInfo}
            onPlayPauseChange={playing => {
              if (playing && !cineService.getState().isCineEnabled) {
                cineService.setIsCineEnabled(true);
              }
              const current = cines?.[viewportId] ?? {};
              cineService.setCine({
                id: viewportId,
                isPlaying: playing,
                frameRate: current.frameRate ?? frameRate,
                cinePlayMode: current.cinePlayMode ?? cinePlayMode,
                frameStep: current.frameStep ?? frameStep,
              });
              if (!playing) {
                cineService.stopClip(enabledVPElement, { viewportId });
              }
            }}
            onFrameChange={nextFrame => {
              cineService.setCine({ id: viewportId, isPlaying: false });
              cornerstoneViewportService.getCornerstoneViewport(viewportId)?.setImageIdIndex?.(nextFrame - 1);
              setStackCineInfo(prev => (prev ? { ...prev, currentFrame: nextFrame } : prev));
            }}
          />
        )}
      </>
    );
  }

  return (
    <RenderCinePlayer
      viewportId={viewportId}
      cineService={cineService}
      frameRate={frameRate}
      isPlaying={isPlaying}
      cinePlayMode={cinePlayMode}
      frameStep={frameStep}
      dynamicInfo={dynamicInfo}
      stackCineInfo={stackCineInfo}
      customizationService={customizationService}
      cornerstoneViewportService={cornerstoneViewportService}
      servicesManager={servicesManager}
      useUnifiedCineControl={useUnifiedCineControl}
      usePerViewportUsCine={false}
    />
  );
}

const VIEWPORT_GRID_CONTAINER_SELECTOR = '[data-cy="viewport-grid-container"]';

function RenderCinePlayer({
  viewportId,
  cineService,
  frameRate: cineFrameRate,
  isPlaying,
  cinePlayMode,
  frameStep,
  dynamicInfo: dynamicInfoProp,
  stackCineInfo: stackCineInfoProp,
  customizationService,
  cornerstoneViewportService,
  servicesManager,
  useUnifiedCineControl = false,
  usePerViewportUsCine = false,
}) {
  const CinePlayerComponent = customizationService.getCustomization('cinePlayer');

  const [dynamicInfo, setDynamicInfo] = useState(dynamicInfoProp);
  const [stackCineInfo, setStackCineInfo] = useState(stackCineInfoProp);
  const [gridContainer, setGridContainer] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (!useUnifiedCineControl) {
      setGridContainer(null);
      return;
    }

    const resolveGridContainer = () =>
      document.querySelector(VIEWPORT_GRID_CONTAINER_SELECTOR) as HTMLElement | null;

    setGridContainer(resolveGridContainer());
  }, [useUnifiedCineControl]);

  useEffect(() => {
    setDynamicInfo(dynamicInfoProp);
  }, [dynamicInfoProp]);

  useEffect(() => {
    setStackCineInfo(stackCineInfoProp);
  }, [stackCineInfoProp]);

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

  const updateStackCineInfo = useCallback(
    props => {
      const { currentFrame } = props;

      if (currentFrame == null) {
        return;
      }

      const viewport = cornerstoneViewportService.getCornerstoneViewport(viewportId);
      const { isCineEnabled } = cineService.getState();

      if (isCineEnabled) {
        cineService.setCine({ id: viewportId, isPlaying: false });
      }

      viewport?.setImageIdIndex?.(currentFrame - 1);
      setStackCineInfo(prev =>
        prev
          ? {
              ...prev,
              currentFrame,
            }
          : prev
      );
    },
    [cornerstoneViewportService, cineService, viewportId]
  );

  const refreshStackCineInfo = useCallback(() => {
    setStackCineInfo(
      buildUsStackCineInfo({
        cornerstoneViewportService,
        viewportId,
        displaySetService: servicesManager.services.displaySetService,
        viewportGridService: servicesManager.services.viewportGridService,
        servicesManager,
      })
    );
  }, [cornerstoneViewportService, servicesManager, viewportId]);

  const handleAdvanceUsBatch = useCallback(() => {
    cineDebug('CinePlayer', 'advanceUsBatch', { viewportId });
    advanceUsBatch(servicesManager, 1);
    refreshStackCineInfo();
    window.setTimeout(refreshStackCineInfo, 400);
  }, [refreshStackCineInfo, servicesManager, viewportId]);

  const handleRetreatUsBatch = useCallback(() => {
    cineDebug('CinePlayer', 'retreatUsBatch', { viewportId });
    advanceUsBatch(servicesManager, -1);
    refreshStackCineInfo();
    window.setTimeout(refreshStackCineInfo, 400);
  }, [refreshStackCineInfo, servicesManager, viewportId]);

  const cinePreferences = getCinePreferences();
  const cinePlayer = (
    <CinePlayerComponent
      portaled={useUnifiedCineControl}
      placement={usePerViewportUsCine ? 'bottom-center' : useUnifiedCineControl ? 'top-center' : 'bottom-center'}
      compact={useUnifiedCineControl || usePerViewportUsCine || !!stackCineInfo}
      frameRate={cineFrameRate}
      cinePlayMode={cinePlayMode}
      frameStep={frameStep}
      showFps={cinePreferences.showFps}
      showFr={cinePreferences.showFr}
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
        const { cines } = cineService.getState();
        const current = cines?.[viewportId] ?? {};
        cineService.setCine({
          id: viewportId,
          isPlaying: playing,
          frameRate: current.frameRate,
          cinePlayMode: current.cinePlayMode,
          frameStep: current.frameStep,
        });
      }}
      onFrameRateChange={nextFrameRate => {
        cineDebug('CinePlayer', 'onFrameRateChange', { viewportId, nextFrameRate });
        cineService.setCine({
          id: viewportId,
          frameRate: nextFrameRate,
          cinePlayMode: 'fps',
        });
      }}
      onCinePlayModeChange={mode => {
        cineService.setCine({
          id: viewportId,
          cinePlayMode: mode,
        });
      }}
      onFrameStepChange={nextFrameStep => {
        cineService.setCine({
          id: viewportId,
          frameStep: nextFrameStep,
          cinePlayMode: 'step',
        });
      }}
      dynamicInfo={dynamicInfo}
      updateDynamicInfo={updateDynamicInfo}
      stackCineInfo={stackCineInfo}
      showStackFrameCounter={!useUnifiedCineControl || usePerViewportUsCine}
      updateStackCineInfo={updateStackCineInfo}
      onAdvanceUsBatch={handleAdvanceUsBatch}
      onRetreatUsBatch={handleRetreatUsBatch}
    />
  );

  if (useUnifiedCineControl && gridContainer) {
    return createPortal(
      <div
        className="pointer-events-none absolute top-2 left-1/2 z-50 -translate-x-1/2"
        data-cy="unified-cine-player"
      >
        {cinePlayer}
      </div>,
      gridContainer
    );
  }

  return cinePlayer;
}

export default WrappedCinePlayer;
