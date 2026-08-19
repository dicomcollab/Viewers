import React, { useCallback, useEffect, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useCine } from '@ohif/ui-next';
import { Enums, eventTarget, cache, metaData, getEnabledElement } from '@cornerstonejs/core';
import { useAppConfig } from '@state';
import { cineDebug, cineDebugWarn } from '../../utils/cineDebug';
import {
  getCineControlViewportId,
  isMultiframeStackDisplaySet,
  isUsMultiframeDisplaySet,
  shouldUsePerViewportCine,
  shouldUseUnifiedCineControl,
  viewportSupportsCine,
} from '../../utils/cineSyncUtils';
import UsViewportCineBar from './UsViewportCineBar';
import { advanceUsBatch, shouldSuppressCineAutoplay } from '../../utils/usBatchNavigationUtils';
import {
  buildUsStackCineInfo,
  getUsCineFrameRate,
  DEFAULT_US_FRAME_STEP,
  US_CINE_DEFAULT_FPS,
  type UsStackCineInfo,
} from '../../utils/usStackCineUtils';
import {
  getCinePreferences,
  getDefaultCinePlayMode,
  shouldAutoPlayCine,
} from '../../utils/cinePreferencesUtils';
import {
  applyCineFrameRate,
  requestCineFrameChange,
  requestCinePlayPause,
} from '../../utils/usCinePlaybackUtils';
import {
  isCinePlaybackManaged,
  startSyncStartDriver,
} from '../../utils/usCineSyncPlaybackDriver';
import { getCineSyncMode } from '../../utils/cineSyncModeStore';
import { isUsFrameDistributionEnabled } from '@ohif/extension-default';
import { isCineClipRunning } from '../../utils/cineClipStateUtils';
import {
  getAliveViewport,
  getViewportFrameCount,
  getViewportFrameIndex,
} from '../../utils/safeViewportFrameUtils';

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
  const [newStackFrameRate, setNewStackFrameRate] = useState(US_CINE_DEFAULT_FPS);
  const [dynamicInfo, setDynamicInfo] = useState(null);
  const [stackCineInfo, setStackCineInfo] = useState<UsStackCineInfo | null>(null);
  const [appConfig] = useAppConfig();
  const [playbackEpoch, setPlaybackEpoch] = useState(0);

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
  /** Display set UID last used to seed DICOM FPS — keep user FPS until the instance changes. */
  const lastFpsDisplaySetUidRef = useRef<string | null>(null);

  cinesRef.current = cines;
  isCineEnabledRef.current = isCineEnabled;
  cineServiceRef.current = cineService;
  enabledVPElementRef.current = enabledVPElement;

  const isPlaying = cines?.[viewportId]?.isPlaying ?? false;
  const frameRate = cines?.[viewportId]?.frameRate ?? US_CINE_DEFAULT_FPS;
  const cinePlayMode = cines?.[viewportId]?.cinePlayMode ?? 'fps';
  const frameStep = cines?.[viewportId]?.frameStep ?? DEFAULT_US_FRAME_STEP;

  const applyPlayback = useCallback(
    (playing: boolean, fps: number, force = false) => {
      const service = cineServiceRef.current;
      const liveViewport = getAliveViewport(cornerstoneViewportService, viewportId);
      const element = liveViewport?.element ?? enabledVPElementRef.current;

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
      const clipRunning = isCineClipRunning(element, viewportId);

      const enabledElement = getEnabledElement(element);
      const viewport = liveViewport ?? enabledElement?.viewport;
      const imageIdCount = getViewportFrameCount(viewport);
      const canPlay = imageIdCount > 1;

      // Layout reuse keeps isPlaying + FPS the same while the CS clip is dead.
      // `force` is required because cine tool state can still hold a stale intervalId.
      if (
        !force &&
        last?.isPlaying === playing &&
        last?.frameRate === validFrameRate &&
        last?.cinePlayMode === cinePlayMode &&
        last?.frameStep === frameStep &&
        (!playing || clipRunning)
      ) {
        cineDebug('CinePlayer', 'applyPlayback skipped — unchanged', {
          viewportId,
          playing,
          fps: validFrameRate,
        });
        return;
      }

      if (playing) {
        cineDebug('CinePlayer', 'applyPlayback → playClip', {
          viewportId,
          fps: validFrameRate,
          hasEnabledElement: !!enabledElement,
          cornerstoneViewportId: viewport?.id,
          imageIdCount,
          clipRunning,
        });

        if (!canPlay) {
          lastPlaybackRef.current = null;
          cineDebugWarn('CinePlayer', 'Cannot play — viewport not ready or single frame', {
            viewportId,
            imageIdCount,
            hasEnabledElement: !!enabledElement,
          });
          return;
        }

        lastPlaybackRef.current = {
          isPlaying: playing,
          frameRate: validFrameRate,
          cinePlayMode,
          frameStep,
        };

        service.playClip(element, {
          framesPerSecond: validFrameRate,
          viewportId,
          cinePlayMode,
          frameStep,
        });
      } else {
        lastPlaybackRef.current = {
          isPlaying: playing,
          frameRate: validFrameRate,
          cinePlayMode,
          frameStep,
        };
        cineDebug('CinePlayer', 'applyPlayback → stopClip', {
          viewportId,
          imageIdCount,
        });
        service.stopClip(element, { viewportId });
      }
    },
    [cinePlayMode, cornerstoneViewportService, frameStep, viewportId]
  );

  const refreshStackCineInfo = useCallback(() => {
    setStackCineInfo(prev => {
      const next = buildUsStackCineInfo({
        cornerstoneViewportService,
        viewportId,
        displaySetService,
        viewportGridService,
        servicesManager,
      });

      if (!next) {
        return next;
      }

      if (
        prev &&
        prev.currentFrame === next.currentFrame &&
        prev.numFrames === next.numFrames &&
        prev.viewportId === next.viewportId
      ) {
        return prev;
      }

      return next;
    });
  }, [
    cornerstoneViewportService,
    displaySetService,
    servicesManager,
    viewportGridService,
    viewportId,
  ]);

  const newDisplaySetHandler = useCallback(() => {
    // Frame Dist pauses cine on apply, so isCineEnabled is often false. Still
    // refresh the per-viewport bar so it appears on the first 2×2 layout, not
    // only after the user pages next/prev.
    refreshStackCineInfo();

    if (!enabledVPElementRef.current) {
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
    // Force playClip after a display-set swap; stopClip from paging can leave
    // lastPlaybackRef looking "unchanged" while the interval is already dead.
    lastPlaybackRef.current = null;
    setPlaybackEpoch(value => value + 1);
    let nextFrameRate = US_CINE_DEFAULT_FPS;
    const existingCine = cinesRef.current[viewportId];
    const hasExplicitPlayState = typeof existingCine?.isPlaying === 'boolean';
    let nextIsPlaying = hasExplicitPlayState ? !!existingCine.isPlaying : false;
    let nextCinePlayMode = cinesRef.current[viewportId]?.cinePlayMode ?? defaultPlayMode;
    let nextFrameStep = cinesRef.current[viewportId]?.frameStep ?? DEFAULT_US_FRAME_STEP;
    let nextStackCineInfo = null;

    // Each multiframe instance keeps its own DICOM-derived FPS.
    // If the doctor changes FPS on this tile, keep that value until the instance changes.
    const resolveMultiframeRate = (displaySet) => {
      const existing = cinesRef.current[viewportId];
      const displaySetUid = displaySet?.displaySetInstanceUID;
      const sameInstance =
        displaySetUid != null && lastFpsDisplaySetUidRef.current === displaySetUid;
      const dicomFrameRate = getUsCineFrameRate(displaySet);

      if (displaySetUid) {
        lastFpsDisplaySetUidRef.current = displaySetUid;
      }

      return {
        frameRate:
          sameInstance && existing?.frameRate != null && Number.isFinite(existing.frameRate)
            ? existing.frameRate
            : dicomFrameRate,
        // When fr is disabled, always use FPS mode (ignore stale step state).
        cinePlayMode: cinePreferences.showFr
          ? (existing?.cinePlayMode ?? defaultPlayMode)
          : 'fps',
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
        // Autoplay US on first load. Next/prev must not start cine if the user paused.
        if (
          autoPlayEnabled &&
          isUsMultiframeDisplaySet(displaySet) &&
          !shouldSuppressCineAutoplay() &&
          !isUsFrameDistributionEnabled() &&
          (!hasExplicitPlayState || existingCine.isPlaying)
        ) {
          nextIsPlaying = true;
        }
      } else if (displaySet.FrameRate || displaySet.FrameTime || displaySet.RecommendedDisplayFrameRate) {
        nextFrameRate = getUsCineFrameRate(displaySet);
        if (
          autoPlayEnabled &&
          displaySet.Modality === 'US' &&
          !shouldSuppressCineAutoplay() &&
          !isUsFrameDistributionEnabled() &&
          (!hasExplicitPlayState || existingCine.isPlaying)
        ) {
          nextIsPlaying = true;
        }
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

    if (nextIsPlaying && getCineSyncMode() === 'syncStart') {
      startSyncStartDriver(servicesManager, { [viewportId]: nextFrameRate });
    }

    setNewStackFrameRate(nextFrameRate);
  }, [
    appConfig.autoPlayCine,
    cornerstoneViewportService,
    displaySetService,
    refreshStackCineInfo,
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
    refreshStackCineInfo();

    const { viewportGridService: gridService } = servicesManager.services;
    let lastLayoutKey = '';

    const getLayoutKey = () => {
      const state = gridService.getState();
      const { viewports, layout } = state;
      const vp = viewports.get(viewportId);
      const rows = layout?.numRows ?? 0;
      const cols = layout?.numCols ?? 0;

      return `${rows}x${cols}|${Array.from(viewports.keys()).join(',')}|${(vp?.displaySetInstanceUIDs ?? []).join(',')}`;
    };

    const onGridChanged = () => {
      refreshStackCineInfo();
      const nextKey = getLayoutKey();

      if (nextKey === lastLayoutKey) {
        return;
      }

      lastLayoutKey = nextKey;
      lastPlaybackRef.current = null;
      setPlaybackEpoch(value => value + 1);
    };

    lastLayoutKey = getLayoutKey();
    const gridSub = gridService.subscribe(gridService.EVENTS.GRID_STATE_CHANGED, onGridChanged);

    // Layout/Frame Dist can assign stacks before Cornerstone finishes enabling
    // the new viewports; retry until image ids are present so the bar mounts.
    let attempts = 0;
    const retryHandle = window.setInterval(() => {
      attempts += 1;
      refreshStackCineInfo();

      try {
        const viewport = getAliveViewport(cornerstoneViewportService, viewportId);
        const ready = getViewportFrameCount(viewport) > 1;

        if (ready || attempts >= 20) {
          window.clearInterval(retryHandle);
        }
      } catch {
        if (attempts >= 20) {
          window.clearInterval(retryHandle);
        }
      }
    }, 100);

    return () => {
      gridSub.unsubscribe();
      window.clearInterval(retryHandle);
    };
  }, [cornerstoneViewportService, refreshStackCineInfo, servicesManager, viewportId]);

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
        applyPlayback(false, frameRate, true);
      }
      lastPlaybackRef.current = null;
      return;
    }

    const wantPlay = isPlaying && !isCinePlaybackManaged(viewportId);
    applyPlayback(wantPlay, frameRate, true);

    if (!wantPlay) {
      return;
    }

    let attempts = 0;
    const retryHandle = window.setInterval(() => {
      attempts += 1;

      if (isCinePlaybackManaged(viewportId)) {
        window.clearInterval(retryHandle);
        return;
      }

      const liveViewport = getAliveViewport(cornerstoneViewportService, viewportId);
      const element = liveViewport?.element ?? enabledVPElementRef.current;
      const ready = getViewportFrameCount(liveViewport) > 1;

      if (attempts >= 30) {
        window.clearInterval(retryHandle);
        return;
      }

      if (!ready) {
        return;
      }

      if (isCineClipRunning(element, viewportId)) {
        window.clearInterval(retryHandle);
        return;
      }

      applyPlayback(true, frameRate, true);
    }, 120);

    return () => window.clearInterval(retryHandle);
  }, [
    isCineEnabled,
    isPlaying,
    frameRate,
    cinePlayMode,
    frameStep,
    applyPlayback,
    enabledVPElement,
    viewportId,
    playbackEpoch,
    cornerstoneViewportService,
  ]);

  useEffect(() => {
    if (!isCineEnabled || !isPlaying) {
      return;
    }

    let lastIndex = -1;
    let staleTicks = 0;
    const staleLimit = Math.max(3, Math.ceil((2500 / Math.max(frameRate, 1)) / 400));

    const watchdog = window.setInterval(() => {
      if (isCinePlaybackManaged(viewportId)) {
        return;
      }

      const liveViewport = getAliveViewport(cornerstoneViewportService, viewportId);

      if (getViewportFrameCount(liveViewport) <= 1) {
        return;
      }

      const index = getViewportFrameIndex(liveViewport);

      if (index !== lastIndex) {
        lastIndex = index;
        staleTicks = 0;
        return;
      }

      staleTicks += 1;

      if (staleTicks < staleLimit) {
        return;
      }

      staleTicks = 0;
      lastPlaybackRef.current = null;
      applyPlayback(true, frameRate, true);
    }, 400);

    return () => window.clearInterval(watchdog);
  }, [
    applyPlayback,
    cornerstoneViewportService,
    frameRate,
    isCineEnabled,
    isPlaying,
    viewportId,
  ]);

  useEffect(() => {
    const onFrameChanged = (evt?: Event) => {
      const detailViewportId = (evt as CustomEvent)?.detail?.viewportId;

      if (detailViewportId && detailViewportId !== viewportId) {
        return;
      }

      refreshStackCineInfo();
    };

    eventTarget.addEventListener(Enums.Events.STACK_NEW_IMAGE, onFrameChanged);
    eventTarget.addEventListener(Enums.Events.STACK_VIEWPORT_SCROLL, onFrameChanged);

    if (enabledVPElement) {
      enabledVPElement.addEventListener(Enums.Events.STACK_NEW_IMAGE, onFrameChanged);
      enabledVPElement.addEventListener(Enums.Events.IMAGE_RENDERED, onFrameChanged);
      enabledVPElement.addEventListener(Enums.Events.STACK_VIEWPORT_SCROLL, onFrameChanged);
    }

    return () => {
      eventTarget.removeEventListener(Enums.Events.STACK_NEW_IMAGE, onFrameChanged);
      eventTarget.removeEventListener(Enums.Events.STACK_VIEWPORT_SCROLL, onFrameChanged);

      if (enabledVPElement) {
        enabledVPElement.removeEventListener(Enums.Events.STACK_NEW_IMAGE, onFrameChanged);
        enabledVPElement.removeEventListener(Enums.Events.IMAGE_RENDERED, onFrameChanged);
        enabledVPElement.removeEventListener(Enums.Events.STACK_VIEWPORT_SCROLL, onFrameChanged);
      }
    };
  }, [enabledVPElement, refreshStackCineInfo, viewportId]);

  useEffect(() => {
    if (!isPlaying) {
      return;
    }

    refreshStackCineInfo();
    const intervalId = window.setInterval(refreshStackCineInfo, 80);

    return () => window.clearInterval(intervalId);
  }, [isPlaying, refreshStackCineInfo]);

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
            frameRate={frameRate}
            stackCineInfo={stackCineInfo}
            onPlayPauseChange={playing => {
              requestCinePlayPause(servicesManager, viewportId, playing);
            }}
            onFrameChange={nextFrame => {
              requestCineFrameChange(servicesManager, viewportId, nextFrame);
              setStackCineInfo(prev => (prev ? { ...prev, currentFrame: nextFrame } : prev));
            }}
            onFrameRateChange={nextFrameRate => {
              applyCineFrameRate(servicesManager, viewportId, nextFrameRate);
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

        if (viewport && !viewport.isDisabled) {
          try {
            viewport.setImageIdIndex?.(dimensionGroupNumber - 1);
          } catch {
            // Viewport was destroyed during a layout swap.
          }
        }
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

      requestCineFrameChange(servicesManager, viewportId, currentFrame);
      setStackCineInfo(prev =>
        prev
          ? {
              ...prev,
              currentFrame,
            }
          : prev
      );
    },
    [servicesManager, viewportId]
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
        requestCinePlayPause(servicesManager, viewportId, playing);
      }}
      onFrameRateChange={nextFrameRate => {
        cineDebug('CinePlayer', 'onFrameRateChange', { viewportId, nextFrameRate });
        applyCineFrameRate(servicesManager, viewportId, nextFrameRate);
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
