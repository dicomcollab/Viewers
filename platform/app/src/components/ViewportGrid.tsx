import React, { useEffect, useCallback, useRef, useMemo, useState } from 'react';
import { Types } from '@ohif/core';
import { ViewportGrid, ViewportPane, ProgressLoadingBar } from '@ohif/ui-next';
import { useViewportGrid } from '@ohif/ui-next';
import EmptyViewport from './EmptyViewport';
import { useAppConfig } from '@state';
import { EVENTS, eventTarget } from '@cornerstonejs/core';

type WadoUidKey = { studyUID: string | null; seriesUID: string | null; objectUID: string | null };

function normalizeImageIdToUrl(imageId?: string) {
  if (!imageId || typeof imageId !== 'string') {
    return null;
  }

  const idx = imageId.indexOf(':');
  const proto = idx > -1 ? imageId.slice(0, idx) : null;
  const hasKnownPrefix = proto && ['dicomweb', 'dicomweb-jpeg', 'wadouri'].includes(proto);
  let url = hasKnownPrefix ? imageId.slice(idx + 1) : imageId;
  if (url.startsWith('//')) {
    url = url.slice(2);
  }
  return url || null;
}

function extractWadoUids(url: string | null) {
  if (!url || typeof url !== 'string') {
    return null;
  }

  try {
    // Use a dummy base to handle relative URLs.
    const parsed = new URL(url, 'http://ohif.local');
    const params = parsed.searchParams;
    const studyUID = params.get('studyUID') || params.get('studyInstanceUID') || null;
    const seriesUID = params.get('seriesUID') || null;
    const objectUID = params.get('objectUID') || params.get('sopInstanceUID') || null;
    if (!studyUID && !seriesUID && !objectUID) {
      return null;
    }
    return { studyUID, seriesUID, objectUID };
  } catch {
    // Fallback: quick parsing for strings that aren't valid URLs.
    const get = (key: string) => {
      const m = url.match(new RegExp(`[?&]${key}=([^&]+)`));
      return m ? decodeURIComponent(m[1]) : null;
    };
    const studyUID = get('studyUID') || get('studyInstanceUID');
    const seriesUID = get('seriesUID');
    const objectUID = get('objectUID') || get('sopInstanceUID');
    if (!studyUID && !seriesUID && !objectUID) {
      return null;
    }
    return { studyUID, seriesUID, objectUID };
  }
}

function isVolumeLikeViewport(viewportOptions: any) {
  const viewportType = viewportOptions?.viewportType;
  if (typeof viewportType !== 'string') {
    return false;
  }

  // Common OHIF/CS viewport types: 'stack', 'volume', 'orthographic', etc.
  return viewportType.toLowerCase().includes('volume') || viewportType.toLowerCase().includes('orthographic');
}

function doesUidMatch(targetKey: WadoUidKey | null, requestKey: WadoUidKey | null) {
  if (!targetKey || !requestKey) {
    return false;
  }

  const isSameObject =
    targetKey.objectUID && requestKey.objectUID && targetKey.objectUID === requestKey.objectUID;
  const isSameSeries =
    !targetKey.seriesUID || !requestKey.seriesUID || targetKey.seriesUID === requestKey.seriesUID;
  const isSameStudy =
    !targetKey.studyUID || !requestKey.studyUID || targetKey.studyUID === requestKey.studyUID;

  return Boolean(isSameObject && isSameSeries && isSameStudy);
}

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
  const [viewportFirstImageRenderedById, setViewportFirstImageRenderedById] = useState<Record<string, boolean>>({});
  const [viewportFirstImageDownloadedById, setViewportFirstImageDownloadedById] = useState<Record<string, boolean>>({});
  const [viewportByteProgressById, setViewportByteProgressById] = useState<Record<string, number | null>>({});
  const [viewportIsProgressComputableById, setViewportIsProgressComputableById] = useState<Record<string, boolean>>({});
  const [viewportInFlightById, setViewportInFlightById] = useState<Record<string, boolean>>({});

  const viewportFirstTargets = useMemo(() => {
    const targets: Record<
      string,
      {
        viewportId: string;
        targetImageId: string | null;
        targetUrl: string | null;
        targetUidKey: WadoUidKey | null;
        isIndeterminate: boolean;
        hasDisplaySets: boolean;
      }
    > = {};

    for (const vp of viewports.values()) {
      const viewportId = vp?.viewportOptions?.viewportId;
      if (!viewportId) {
        continue;
      }

      const displaySetInstanceUIDs: string[] = vp?.displaySetInstanceUIDs || [];
      const displaySets = displaySetInstanceUIDs
        .map(uid => displaySetService.getDisplaySetByUID(uid) || {})
        .filter(ds => !ds?.unsupported);

      const hasDisplaySets = displaySets.length > 0;
      const isIndeterminate = isVolumeLikeViewport(vp?.viewportOptions);

      const firstDisplaySet: any = displaySets[0];
      const firstImageId =
        Array.isArray(firstDisplaySet?.images) && firstDisplaySet.images.length > 0
          ? firstDisplaySet.images[0]?.imageId ?? null
          : null;
      const firstUrl = normalizeImageIdToUrl(firstImageId ?? undefined);
      const firstUidKey = extractWadoUids(firstUrl);

      targets[viewportId] = {
        viewportId,
        targetImageId: firstImageId,
        targetUrl: firstUrl,
        targetUidKey: firstUidKey,
        isIndeterminate,
        hasDisplaySets,
      };
    }

    return targets;
  }, [viewports, displaySetService]);

  const viewportFirstTargetsRef = useRef(viewportFirstTargets);
  useEffect(() => {
    viewportFirstTargetsRef.current = viewportFirstTargets;
  }, [viewportFirstTargets]);

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
      const firstTarget = viewportFirstTargets[viewportId];
      const hasFirstRendered = Boolean(viewportFirstImageRenderedById[viewportId]);
      const hasFirstDownloaded = Boolean(viewportFirstImageDownloadedById[viewportId]);
      const inFlight = Boolean(viewportInFlightById[viewportId]);
      const progressValue = viewportByteProgressById[viewportId];
      const progressComputable = Boolean(viewportIsProgressComputableById[viewportId]);
      const canShowPercent =
        Boolean(firstTarget?.hasDisplaySets) &&
        !firstTarget?.isIndeterminate &&
        progressComputable &&
        typeof progressValue === 'number' &&
        !Number.isNaN(progressValue);
      const displayedPercent = canShowPercent
        ? Math.round(Math.max(0, Math.min(1, progressValue as number)) * 100)
        : undefined;
      const showViewportLoader =
        Boolean(firstTarget?.hasDisplaySets) &&
        !hasFirstRendered &&
        !hasFirstDownloaded;
      const loadingText =
        typeof displayedPercent === 'number' ? `Loading images... ${displayedPercent}%` : 'Loading images...';

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
            className="relative flex h-full w-full min-w-[5px] flex-col"
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
                setViewportFirstImageRenderedById(prev => ({ ...prev, [viewportId]: true }));
                setViewportFirstImageDownloadedById(prev => ({ ...prev, [viewportId]: true }));
                setViewportInFlightById(prev => ({ ...prev, [viewportId]: false }));
                setViewportIsProgressComputableById(prev => ({ ...prev, [viewportId]: true }));
                setViewportByteProgressById(prev => ({ ...prev, [viewportId]: 1 }));
              }}
            />
            {showViewportLoader && (
              <div
                className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-black/70"
                aria-busy="true"
                aria-label="Loading images"
              >
                <div className="w-[280px] space-y-3">
                  <p className="text-primary-light text-center text-sm font-medium">{loadingText}</p>
                  <ProgressLoadingBar progress={canShowPercent ? displayedPercent : undefined} />
                </div>
              </div>
            )}
          </div>
        </ViewportPane>
      );
    }

    return viewportPanes;
  }, [
    viewports,
    activeViewportId,
    viewportComponents,
    dataSource,
    viewportFirstTargets,
    viewportFirstImageRenderedById,
    viewportFirstImageDownloadedById,
    viewportInFlightById,
    viewportByteProgressById,
    viewportIsProgressComputableById,
  ]);

  // Reset per-viewport loader state when a viewport is reassigned to a different first image.
  const prevViewportFirstTargetsRef = useRef(viewportFirstTargets);
  useEffect(() => {
    const prevTargets = prevViewportFirstTargetsRef.current || {};
    const nextTargets = viewportFirstTargets || {};
    prevViewportFirstTargetsRef.current = nextTargets;

    const allViewportIds = new Set([...Object.keys(prevTargets), ...Object.keys(nextTargets)]);
    const viewportIdsToReset: string[] = [];

    for (const viewportId of allViewportIds) {
      const prev = prevTargets[viewportId];
      const next = nextTargets[viewportId];

      if (!next) {
        viewportIdsToReset.push(viewportId);
        continue;
      }

      const prevObjectUID = prev?.targetUidKey?.objectUID ?? null;
      const nextObjectUID = next?.targetUidKey?.objectUID ?? null;
      const prevImageId = prev?.targetImageId ?? null;
      const nextImageId = next?.targetImageId ?? null;

      const changed = prevObjectUID !== nextObjectUID || prevImageId !== nextImageId;
      if (changed) {
        viewportIdsToReset.push(viewportId);
      }
    }

    if (!viewportIdsToReset.length) {
      return;
    }

    setViewportFirstImageRenderedById(prev => {
      const next = { ...prev };
      viewportIdsToReset.forEach(id => delete next[id]);
      return next;
    });
    setViewportFirstImageDownloadedById(prev => {
      const next = { ...prev };
      viewportIdsToReset.forEach(id => delete next[id]);
      return next;
    });
    setViewportByteProgressById(prev => {
      const next = { ...prev };
      viewportIdsToReset.forEach(id => delete next[id]);
      return next;
    });
    setViewportIsProgressComputableById(prev => {
      const next = { ...prev };
      viewportIdsToReset.forEach(id => delete next[id]);
      return next;
    });
    setViewportInFlightById(prev => {
      const next = { ...prev };
      viewportIdsToReset.forEach(id => delete next[id]);
      return next;
    });
  }, [viewportFirstTargets]);

  // Robust fallback: if Cornerstone reports that an image was rendered, mark that viewport complete.
  useEffect(() => {
    const handleImageRendered = evt => {
      if (evt?.detail?.viewportStatus === 'preRender') {
        return;
      }
      const renderedViewportId = evt?.detail?.viewportId;
      if (renderedViewportId) {
        setViewportFirstImageRenderedById(prev => {
          if (prev[renderedViewportId]) {
            return prev;
          }
          return { ...prev, [renderedViewportId]: true };
        });
      }
    };

    eventTarget.addEventListener(EVENTS.IMAGE_RENDERED, handleImageRendered);
    return () => {
      eventTarget.removeEventListener(EVENTS.IMAGE_RENDERED, handleImageRendered);
    };
  }, []);
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
      const requestUrl = evt?.detail?.requestUrl;
      if (!requestId) {
        return;
      }

      if (!requestUrl || typeof requestUrl !== 'string') {
        return;
      }

      // Scope progress to the matching viewport's first-image identity.
      // WADO URLs can differ, so we match by objectUID (and study/series when available).
      const requestKey = extractWadoUids(requestUrl);
      if (!requestKey) {
        return;
      }

      const targets = viewportFirstTargetsRef.current || {};
      const matchingViewportIds = Object.keys(targets).filter(viewportId =>
        doesUidMatch(targets[viewportId]?.targetUidKey ?? null, requestKey)
      );
      if (!matchingViewportIds.length) {
        return;
      }

      for (const viewportId of matchingViewportIds) {
        if (done) {
          setViewportFirstImageDownloadedById(prev => ({ ...prev, [viewportId]: true }));
          setViewportInFlightById(prev => ({ ...prev, [viewportId]: false }));
          setViewportIsProgressComputableById(prev => ({ ...prev, [viewportId]: true }));
          setViewportByteProgressById(prev => ({ ...prev, [viewportId]: 1 }));
          continue;
        }

        setViewportInFlightById(prev => ({ ...prev, [viewportId]: true }));
        setViewportIsProgressComputableById(prev => ({ ...prev, [viewportId]: lengthComputable }));
        if (typeof progress === 'number' && !Number.isNaN(progress)) {
          const clamped = Math.max(0, Math.min(1, progress));
          setViewportByteProgressById(prev => ({ ...prev, [viewportId]: clamped }));
        }
      }
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

      const targets = viewportFirstTargetsRef.current || {};
      const matchingViewportIds = Object.keys(targets).filter(viewportId => targets[viewportId]?.targetImageId === imageId);
      if (!matchingViewportIds.length) {
        return;
      }

      for (const viewportId of matchingViewportIds) {
        if (clamped >= 1) {
          setViewportFirstImageDownloadedById(prev => ({ ...prev, [viewportId]: true }));
          setViewportInFlightById(prev => ({ ...prev, [viewportId]: false }));
        } else {
          setViewportInFlightById(prev => ({ ...prev, [viewportId]: true }));
        }

        setViewportByteProgressById(prev => ({ ...prev, [viewportId]: clamped }));
        setViewportIsProgressComputableById(prev => ({ ...prev, [viewportId]: Boolean(lengthComputable) }));
      }
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

  return (
    <div className="border-input relative h-[calc(100%-0.25rem)] w-full border">
      <ViewportGrid
        numRows={numRows}
        numCols={numCols}
      >
        {getViewportPanes()}
      </ViewportGrid>
      {layoutLoading && (
        <div
          className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-black/70"
          aria-busy="true"
          aria-label="Loading layout"
        >
          <>
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary-light border-t-transparent" />
            <p className="text-primary-light mt-3 text-sm font-medium">Preparing view...</p>
            <p className="text-primary-light/80 mt-1 text-xs">Loading data for this layout</p>
          </>
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
