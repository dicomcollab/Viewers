import React, { useEffect, useCallback, useRef, useMemo, useState } from 'react';
import { Types } from '@ohif/core';
import { ViewportGrid, ViewportPane, ProgressLoadingBar } from '@ohif/ui-next';
import { useViewportGrid } from '@ohif/ui-next';
import EmptyViewport from './EmptyViewport';
import { useAppConfig } from '@state';

function ViewerViewportGrid(props: withAppTypes) {
  const { servicesManager, viewportComponents = [], dataSource, commandsManager } = props;
  const [viewportGrid, viewportGridService] = useViewportGrid();
  const [appConfig] = useAppConfig();

  const { layout, activeViewportId, viewports, isHangingProtocolLayout } = viewportGrid;
  const { numCols, numRows } = layout;
  const layoutHash = useRef(null);

  const { displaySetService, hangingProtocolService, uiNotificationService, customizationService, studyPrefetcherService } =
    servicesManager.services;

  const generateLayoutHash = () => `${numCols}-${numRows}`;

  /**
   * This callback runs after the viewports structure has changed in any way.
   * On initial display, that means if it has changed by applying a HangingProtocol,
   * while subsequently it may mean by changing the stage or by manually adjusting
   * the layout.

   */
  const updateDisplaySetsFromProtocol = (
    _protocol: Types.HangingProtocol.Protocol,
    stage,
    _activeStudyUID,
    viewportMatchDetails
  ) => {
    const availableDisplaySets = displaySetService.getActiveDisplaySets();

    if (!availableDisplaySets.length) {
      console.log('No available display sets', availableDisplaySets);
      return;
    }

    // Match each viewport individually
    const { layoutType } = stage.viewportStructure;
    const stageProps = stage.viewportStructure.properties;
    const { columns: numCols, rows: numRows, layoutOptions = [] } = stageProps;

    /**
     * This find or create viewport uses the hanging protocol results to
     * specify the viewport match details, which specifies the size and
     * setup of the various viewports.
     */
    const findOrCreateViewport = pos => {
      const viewportId = Array.from(viewportMatchDetails.keys())[pos];
      const details = viewportMatchDetails.get(viewportId);
      if (!details) {
        console.log('No match details for viewport', viewportId);
        return;
      }

      const { displaySetsInfo, viewportOptions } = details;
      const displaySetUIDsToHang = [];
      const displaySetUIDsToHangOptions = [];

      displaySetsInfo.forEach(({ displaySetInstanceUID, displaySetOptions }) => {
        if (displaySetInstanceUID) {
          displaySetUIDsToHang.push(displaySetInstanceUID);
        }

        displaySetUIDsToHangOptions.push(displaySetOptions);
      });

      const computedViewportOptions = hangingProtocolService.getComputedOptions(
        viewportOptions,
        displaySetUIDsToHang
      );

      const computedDisplaySetOptions = hangingProtocolService.getComputedOptions(
        displaySetUIDsToHangOptions,
        displaySetUIDsToHang
      );

      return {
        displaySetInstanceUIDs: displaySetUIDsToHang,
        displaySetOptions: computedDisplaySetOptions,
        viewportOptions: computedViewportOptions,
      };
    };

    viewportGridService.setLayout({
      numRows,
      numCols,
      layoutType,
      layoutOptions,
      findOrCreateViewport,
      isHangingProtocolLayout: true,
    });
  };

  const _getUpdatedViewports = useCallback(
    (viewportId, displaySetInstanceUID) => {
      if (!displaySetInstanceUID) {
        return [];
      }

      let updatedViewports = [];
      try {
        updatedViewports = hangingProtocolService.getViewportsRequireUpdate(
          viewportId,
          displaySetInstanceUID,
          isHangingProtocolLayout
        );
      } catch (error) {
        console.warn(error);
        uiNotificationService.show({
          title: 'Drag and Drop',
          message:
            'The selected display sets could not be added to the viewport due to a mismatch in the Hanging Protocol rules.',
          type: 'error',
          duration: 3000,
        });
      }

      return updatedViewports;
    },
    [hangingProtocolService, uiNotificationService, isHangingProtocolLayout]
  );

  // Using Hanging protocol engine to match the displaySets
  useEffect(() => {
    const { unsubscribe } = hangingProtocolService.subscribe(
      hangingProtocolService.EVENTS.PROTOCOL_CHANGED,
      ({ protocol, stage, activeStudyUID, viewportMatchDetails }) => {
        updateDisplaySetsFromProtocol(protocol, stage, activeStudyUID, viewportMatchDetails);
      }
    );

    return () => {
      unsubscribe();
    };
  }, []);

  // Check viewport readiness in useEffect
  useEffect(() => {
    const allReady = viewportGridService.getGridViewportsReady();
    const sameLayoutHash = layoutHash.current === generateLayoutHash();
    if (allReady && !sameLayoutHash) {
      layoutHash.current = generateLayoutHash();
      viewportGridService.publishViewportsReady();
    }
  }, [viewportGridService, generateLayoutHash]);

  const onDropHandler = (viewportId, { displaySetInstanceUID }) => {
    const { viewportGridService } = servicesManager.services;
    const customOnDropHandler = customizationService.getCustomization('customOnDropHandler');
    const dropHandlerPromise = customOnDropHandler({
      ...props,
      viewportId,
      displaySetInstanceUID,
      appConfig,
    });
    dropHandlerPromise.then(({ handled }) => {
      if (!handled) {
        const updatedViewports = _getUpdatedViewports(viewportId, displaySetInstanceUID);

        commandsManager.run('setDisplaySetsForViewports', { viewportsToUpdate: updatedViewports });
      }
    });
    viewportGridService.publishViewportOnDropHandled({ displaySetInstanceUID });
  };

  const getViewportPanes = useCallback(() => {
    const viewportPanes = [];

    const numViewportPanes = viewportGridService.getNumViewportPanes();
    for (let i = 0; i < numViewportPanes; i++) {
      const paneMetadata = Array.from(viewports.values())[i] || {};
      const {
        displaySetInstanceUIDs,
        viewportOptions,
        displaySetOptions, // array of options for each display set in the viewport
        x: viewportX,
        y: viewportY,
        width: viewportWidth,
        height: viewportHeight,
        viewportLabel,
      } = paneMetadata;

      const viewportId = viewportOptions.viewportId;
      const isActive = activeViewportId === viewportId;

      const displaySetInstanceUIDsToUse = displaySetInstanceUIDs || [];

      // This is causing the viewport components re-render when the activeViewportId changes
      const displaySets = displaySetInstanceUIDsToUse
        .map(displaySetInstanceUID => {
          return displaySetService.getDisplaySetByUID(displaySetInstanceUID) || {};
        })
        .filter(displaySet => {
          return !displaySet?.unsupported;
        });

      const { component: ViewportComponent } = _getViewportComponent(
        displaySets,
        viewportComponents,
        uiNotificationService
      );

      // look inside displaySets to see if they need reRendering
      const displaySetsNeedsRerendering = displaySets.some(displaySet => {
        return displaySet.needsRerendering;
      });

      const onInteractionHandler = event => {
        if (isActive) {
          return;
        }

        if (event && (appConfig?.activateViewportBeforeInteraction ?? true)) {
          event.preventDefault();
          event.stopPropagation();
        }

        viewportGridService.setActiveViewportId(viewportId);
      };

      const getBorderStyle = viewportIndex => {
        const style = {} as any;
        const layoutOptions = viewportGridService.getLayoutOptionsFromState(
          viewportGridService.getState()
        );
        const vp = layoutOptions[viewportIndex];
        if (!vp) {
          return style;
        }
        const { x, y, width, height } = vp;
        const tolerance = 0.01;

        if (x + width < 1 - tolerance) {
          style.borderRight = '1px solid hsl(var(--input))';
        }

        if (y + height < 1 - tolerance) {
          style.borderBottom = '1px solid hsl(var(--input))';
        }

        return style;
      };

      viewportPanes[i] = (
        <ViewportPane
          // Note: It is highly important that the key is the viewportId here,
          // since it is used to determine if the component should be re-rendered
          // by React, and also in the hanging protocol and stage changes if the
          // same viewportId is used, React, by default, will only move (not re-render)
          // those components. For instance, if we have a 2x3 layout, and we move
          // from 2x3 to 1x1 (second viewport), if the key is the viewportIndex,
          // React will RE-RENDER the resulting viewport as the key will be different.
          // however, if the key is the viewportId, React will only move the component
          // and not re-render it.
          key={viewportId}
          acceptDropsFor="displayset"
          onDrop={onDropHandler.bind(null, viewportId)}
          onInteraction={onInteractionHandler}
          customStyle={{
            position: 'absolute',
            top: viewportY * 100 + '%',
            left: viewportX * 100 + '%',
            width: viewportWidth * 100 + '%',
            height: viewportHeight * 100 + '%',
            ...getBorderStyle(i),
          }}
          isActive={isActive}
        >
          <div
            data-cy="viewport-pane"
            className="flex h-full w-full min-w-[5px] flex-col"
          >
            <ViewportComponent
              displaySets={displaySets}
              viewportLabel={viewports.size > 1 ? viewportLabel : ''}
              viewportId={viewportId}
              dataSource={dataSource}
              viewportOptions={viewportOptions}
              displaySetOptions={displaySetOptions}
              needsRerendering={displaySetsNeedsRerendering}
              isHangingProtocolLayout={isHangingProtocolLayout}
              onElementEnabled={evt => {
                viewportGridService.setViewportIsReady(viewportId, true);
              }}
              onFirstImageRendered={() => {
                setHasFirstViewportImageRendered(true);
              }}
            />
          </div>
        </ViewportPane>
      );
    }

    return viewportPanes;
  }, [viewports, activeViewportId, viewportComponents, dataSource]);

  /**
   * Show a simple loading state when an advanced layout (MPR, 3D, etc.) is applied
   * and viewport data is still loading. Not the full-screen OHIF default loader.
   */
  const hasPendingHPViewports = useMemo(() => {
    if (!isHangingProtocolLayout || !viewports?.size) {
      return false;
    }
    for (const vp of viewports.values()) {
      if (vp.displaySetInstanceUIDs?.length && vp.isReady === false) {
        return true;
      }
    }
    return false;
  }, [isHangingProtocolLayout, viewports]);

  // Debounce the overlay so it doesn't flash for instant cached switches.
  const [layoutLoading, setLayoutLoading] = useState(false);
  const [viewportLoadingState, setViewportLoadingState] = useState({});
  const [jpegByteProgressByImageId, setJpegByteProgressByImageId] = useState({});
  const [jpegLengthComputableByImageId, setJpegLengthComputableByImageId] = useState({});
  const [wadoInFlightByRequestId, setWadoInFlightByRequestId] = useState({});
  const [wadoProgressByRequestId, setWadoProgressByRequestId] = useState({});
  const [wadoLengthComputableByRequestId, setWadoLengthComputableByRequestId] = useState({});
  const [hasFirstViewportImageRendered, setHasFirstViewportImageRendered] = useState(false);
  useEffect(() => {
    let debounceTimer: number | undefined;
    let maxDurationTimer: number | undefined;

    if (hasPendingHPViewports) {
      debounceTimer = window.setTimeout(() => {
        setLayoutLoading(true);
        // Force-hide overlay after 4s so it never stays stuck (e.g. MPR → single, or ready event missed).
        maxDurationTimer = window.setTimeout(() => {
          setLayoutLoading(false);
        }, 4000);
      }, 150);
    } else {
      setLayoutLoading(false);
    }

    return () => {
      if (debounceTimer) window.clearTimeout(debounceTimer);
      if (maxDurationTimer) window.clearTimeout(maxDurationTimer);
    };
  }, [hasPendingHPViewports]);

  useEffect(() => {
    const handleWadoRequestProgress = evt => {
      const requestId = evt?.detail?.requestId;
      const progress = evt?.detail?.progress;
      const done = Boolean(evt?.detail?.done);
      const lengthComputable = Boolean(evt?.detail?.lengthComputable);
      if (!requestId) {
        return;
      }

      if (done) {
        setWadoInFlightByRequestId(prev => {
          if (!prev[requestId]) {
            return prev;
          }
          const next = { ...prev };
          delete next[requestId];
          return next;
        });
        setWadoProgressByRequestId(prev => {
          if (!(requestId in prev)) {
            return prev;
          }
          const next = { ...prev };
          delete next[requestId];
          return next;
        });
        setWadoLengthComputableByRequestId(prev => {
          if (!(requestId in prev)) {
            return prev;
          }
          const next = { ...prev };
          delete next[requestId];
          return next;
        });
        return;
      }

      setWadoInFlightByRequestId(prev => ({ ...prev, [requestId]: true }));
      if (typeof progress === 'number' && !Number.isNaN(progress)) {
        const clamped = Math.max(0, Math.min(1, progress));
        setWadoProgressByRequestId(prev => ({ ...prev, [requestId]: clamped }));
      }
      setWadoLengthComputableByRequestId(prev => ({ ...prev, [requestId]: lengthComputable }));
    };

    window.addEventListener('ohif:wado-image-request-progress', handleWadoRequestProgress);
    return () => {
      window.removeEventListener('ohif:wado-image-request-progress', handleWadoRequestProgress);
    };
  }, []);

  useEffect(() => {
    const handleJpegImageProgress = evt => {
      const imageId = evt?.detail?.imageId;
      const progress = evt?.detail?.progress;
      const lengthComputable = evt?.detail?.lengthComputable;
      if (!imageId || typeof progress !== 'number' || Number.isNaN(progress)) {
        return;
      }
      const clamped = Math.max(0, Math.min(1, progress));
      setJpegByteProgressByImageId(prev => {
        if (prev[imageId] === clamped) {
          return prev;
        }
        return {
          ...prev,
          [imageId]: clamped,
        };
      });
      setJpegLengthComputableByImageId(prev => {
        const nextValue = Boolean(lengthComputable);
        if (prev[imageId] === nextValue) {
          return prev;
        }
        return {
          ...prev,
          [imageId]: nextValue,
        };
      });
    };

    window.addEventListener('ohif:jpeg-image-progress', handleJpegImageProgress);
    return () => {
      window.removeEventListener('ohif:jpeg-image-progress', handleJpegImageProgress);
    };
  }, []);

  useEffect(() => {
    if (!studyPrefetcherService?.subscribe) {
      return;
    }
    const subProgress = studyPrefetcherService.subscribe(
      studyPrefetcherService.EVENTS.DISPLAYSET_LOAD_PROGRESS,
      ({ displaySetInstanceUID, numInstances, loadingProgress }) => {
        setViewportLoadingState(prev => ({
          ...prev,
          [displaySetInstanceUID]: { loadingProgress, numInstances },
        }));
      }
    );
    const subComplete = studyPrefetcherService.subscribe(
      studyPrefetcherService.EVENTS.DISPLAYSET_LOAD_COMPLETE,
      ({ displaySetInstanceUID }) => {
        setViewportLoadingState(prev => ({
          ...prev,
          [displaySetInstanceUID]: { ...(prev[displaySetInstanceUID] || {}), loadingProgress: 1 },
        }));
      }
    );

    return () => {
      subProgress?.unsubscribe?.();
      subComplete?.unsubscribe?.();
    };
  }, [studyPrefetcherService]);

  /**
   * Loading indicator until numCols and numRows are gotten from the HangingProtocolService
   */
  if (!numRows || !numCols) {
    return null;
  }

  const activeDisplaySets = displaySetService.getActiveDisplaySets?.() || [];
  const hasViewportDisplaySets =
    activeDisplaySets.length > 0 || Array.from(viewports.values()).some(vp => vp?.displaySetInstanceUIDs?.length);
  const rawViewportLoadingPercent = activeDisplaySets.length
    ? Math.round(
        (activeDisplaySets.reduce((sum, ds) => {
          const uid = ds.displaySetInstanceUID;
          const fromState = viewportLoadingState[uid];
          const fromPrefetcher = studyPrefetcherService?.getDisplaySetLoadProgress?.(uid);
          const raw = fromState ?? fromPrefetcher;
          const progress = typeof raw === 'object' && raw != null ? raw.loadingProgress : raw;
          const normalized =
            typeof progress === 'number' && !Number.isNaN(progress)
              ? Math.max(0, Math.min(1, progress))
              : 0;
          const imageIds = Array.isArray(ds?.images)
            ? ds.images.map(image => image?.imageId).filter(Boolean)
            : [];
          const imageProgressValues = imageIds
            .map(imageId => jpegByteProgressByImageId[imageId])
            .filter(value => typeof value === 'number' && !Number.isNaN(value));
          const jpegByteProgress =
            imageProgressValues.length > 0
              ? imageProgressValues.reduce((acc, value) => acc + value, 0) /
                imageProgressValues.length
              : 0;
          return sum + Math.max(normalized, jpegByteProgress);
        }, 0) /
          activeDisplaySets.length) *
          100
      )
    : 0;
  const viewportLoadingPercent = rawViewportLoadingPercent;
  const activeWadoRequestIds = Object.keys(wadoInFlightByRequestId);
  const hasInFlightWadoRequests = activeWadoRequestIds.length > 0;
  const computableWadoProgressValues = activeWadoRequestIds
    .filter(requestId => wadoLengthComputableByRequestId[requestId] === true)
    .map(requestId => wadoProgressByRequestId[requestId])
    .filter(value => typeof value === 'number' && !Number.isNaN(value));
  const hasComputableWadoProgress = computableWadoProgressValues.length > 0;
  const wadoLoadingPercent = hasComputableWadoProgress
    ? Math.round(
        (computableWadoProgressValues.reduce((sum, value) => sum + value, 0) /
          computableWadoProgressValues.length) *
          100
      )
    : null;
  const hasAnyNonComputableByteProgress = activeDisplaySets.some(ds => {
    const imageIds = Array.isArray(ds?.images)
      ? ds.images.map(image => image?.imageId).filter(Boolean)
      : [];
    return imageIds.some(imageId => jpegLengthComputableByImageId[imageId] === false);
  });
  const hasFinishedDownloading =
    hasViewportDisplaySets && viewportLoadingPercent >= 100 && !hasInFlightWadoRequests;
  // Hide the initial image-loading overlay as soon as download progress completes.
  // This avoids a stuck "100%" message over the viewport when first-render event is delayed/missed.
  const showInitialViewportLoading =
    hasInFlightWadoRequests || (!hasFirstViewportImageRendered && !hasFinishedDownloading);
  const shouldShowPercent =
    hasViewportDisplaySets &&
    !hasAnyNonComputableByteProgress &&
    (!hasInFlightWadoRequests || hasComputableWadoProgress);
  const displayedLoadingPercent =
    hasInFlightWadoRequests && hasComputableWadoProgress ? wadoLoadingPercent : viewportLoadingPercent;
  const loadingText = shouldShowPercent
    ? `Loading images... ${displayedLoadingPercent}%`
    : 'Loading images...';

  return (
    <div className="border-input relative h-[calc(100%-0.25rem)] w-full border">
      <ViewportGrid
        numRows={numRows}
        numCols={numCols}
      >
        {getViewportPanes()}
      </ViewportGrid>
      {(layoutLoading || showInitialViewportLoading) && (
        <div
          className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-black/70"
          aria-busy="true"
          aria-label={showInitialViewportLoading ? 'Loading images' : 'Loading layout'}
        >
          {showInitialViewportLoading ? (
            <div className="w-[320px] space-y-3">
              <p className="text-primary-light text-center text-sm font-medium">
                {loadingText}
              </p>
              <ProgressLoadingBar
                progress={hasViewportDisplaySets && shouldShowPercent ? displayedLoadingPercent : undefined}
              />
            </div>
          ) : (
            <>
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary-light border-t-transparent" />
              <p className="text-primary-light mt-3 text-sm font-medium">Preparing view...</p>
              <p className="text-primary-light/80 mt-1 text-xs">Loading data for this layout</p>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function _getViewportComponent(displaySets, viewportComponents, uiNotificationService) {
  if (!displaySets || !displaySets.length) {
    return { component: EmptyViewport, isReferenceViewable: () => false };
  }

  // Todo: Do we have a viewport that has two different SOPClassHandlerIds?
  const SOPClassHandlerId = displaySets[0].SOPClassHandlerId;

  for (let i = 0; i < viewportComponents.length; i++) {
    if (!viewportComponents[i]) {
      throw new Error('viewport components not defined');
    }
    if (!viewportComponents[i].displaySetsToDisplay) {
      throw new Error('displaySetsToDisplay is null');
    }
    if (viewportComponents[i].displaySetsToDisplay.includes(SOPClassHandlerId)) {
      const { component } = viewportComponents[i];
      return { component };
    }
  }

  console.log("Can't show displaySet", SOPClassHandlerId, displaySets[0]);
  uiNotificationService.show({
    title: 'Viewport Not Supported Yet',
    message: `Cannot display SOPClassUID of ${displaySets[0].SOPClassUID} yet`,
    type: 'error',
  });

  return { component: EmptyViewport };
}

export default ViewerViewportGrid;
