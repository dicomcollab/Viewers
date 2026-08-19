import React, { useEffect, useRef, useCallback, useState } from 'react';
import * as cs3DTools from '@cornerstonejs/tools';
import { Enums, EVENTS, eventTarget, getEnabledElement } from '@cornerstonejs/core';
import { MeasurementService, useViewportRef } from '@ohif/core';
import { useViewportDialog } from '@ohif/ui-next';
import type { Types as csTypes } from '@cornerstonejs/core';

import { setEnabledElement } from '../state';

import './OHIFCornerstoneViewport.css';
import CornerstoneOverlays from './Overlays/CornerstoneOverlays';
import CinePlayer from '../components/CinePlayer';
import type { Types } from '@ohif/core';

import OHIFViewportActionCorners from '../components/OHIFViewportActionCorners';
import { getViewportPresentations } from '../utils/presentations/getViewportPresentations';
import { recoverBlankStackViewport } from '../utils/safeViewportFrameUtils';
import { useSynchronizersStore } from '../stores/useSynchronizersStore';
import ActiveViewportBehavior from '../utils/ActiveViewportBehavior';
import { WITH_NAVIGATION } from '../services/ViewportService/CornerstoneViewportService';

const STACK = 'stack';

// Cache for viewport dimensions, persists across component remounts
const viewportDimensions = new Map<string, { width: number; height: number }>();

/** See visibility listener below — ref-counted so the last viewport unmounts cleanly. */
let documentVisibilityRefCount = 0;
let documentVisibilityHandler: (() => void) | null = null;

// Todo: This should be done with expose of internal API similar to react-vtkjs-viewport
// Then we don't need to worry about the re-renders if the props change.
const OHIFCornerstoneViewport = React.memo(
  (
    props: withAppTypes<{
      viewportId: string;
      displaySets: AppTypes.DisplaySet[];
      viewportOptions: AppTypes.ViewportGrid.GridViewportOptions;
      initialImageIndex: number;
    }>
  ) => {
    const {
      displaySets,
      dataSource,
      viewportOptions,
      displaySetOptions,
      servicesManager,
      onElementEnabled,
      // eslint-disable-next-line react/prop-types
      onElementDisabled,
      isJumpToMeasurementDisabled = false,
      // Note: you SHOULD NOT use the initialImageIdOrIndex for manipulation
      // of the imageData in the OHIFCornerstoneViewport. This prop is used
      // to set the initial state of the viewport's first image to render
      // eslint-disable-next-line react/prop-types
      initialImageIndex,
      // if the viewport is part of a hanging protocol layout
      // we should not really rely on the old synchronizers and
      // you see below we only rehydrate the synchronizers if the viewport
      // is not part of the hanging protocol layout. HPs should
      // define their own synchronizers. Since the synchronizers are
      // viewportId dependent and
      // eslint-disable-next-line react/prop-types
      isHangingProtocolLayout,
      onFirstImageRendered,
    } = props;
    const viewportId = viewportOptions.viewportId;

    if (!viewportId) {
      throw new Error('Viewport ID is required');
    }

    // Make sure displaySetOptions has one object per displaySet
    while (displaySetOptions.length < displaySets.length) {
      displaySetOptions.push({});
    }

    // Since we only have support for dynamic data in volume viewports, we should
    // handle this case here and set the viewportType to volume if any of the
    // displaySets are dynamic volumes
    viewportOptions.viewportType = displaySets.some(
      ds => ds.isDynamicVolume && ds.isReconstructable
    )
      ? 'volume'
      : viewportOptions.viewportType;

    const [scrollbarHeight, setScrollbarHeight] = useState('100px');
    const [enabledVPElement, setEnabledVPElement] = useState(null);
    const elementRef = useRef() as React.MutableRefObject<HTMLDivElement>;
    const viewportRef = useViewportRef(viewportId);
    const hasMarkedReadyRef = useRef(false);
    const prevViewportDepsRef = useRef<{
      orientation: string;
      displaySetUIDs: string;
    } | null>(null);
    const hasReportedFirstImageRef = useRef(false);
    const onFirstImageRenderedRef = useRef(onFirstImageRendered);
    /** Remove prior CORNERSTONE_IMAGE_RENDERED listener (attached synchronously on ELEMENT_ENABLED). */
    const imageRenderedCleanupRef = useRef<(() => void) | null>(null);

    useEffect(() => {
      onFirstImageRenderedRef.current = onFirstImageRendered;
    }, [onFirstImageRendered]);

    // Reset "first image rendered" reporting when the displayed content changes.
    // The viewport component is keyed by `viewportId` (not by series), so it is not remounted
    // on series changes; without this reset, `onFirstImageRendered` may only fire once.
    const displaySetUIDsKey = displaySets
      ?.map(ds => (ds as any)?.displaySetInstanceUID ?? (ds as any)?.displaySetUID ?? '')
      .filter(Boolean)
      .join('|');
    useEffect(() => {
      hasReportedFirstImageRef.current = false;
    }, [viewportId, displaySetUIDsKey]);

    const {
      displaySetService,
      toolbarService,
      toolGroupService,
      syncGroupService,
      cornerstoneViewportService,
      segmentationService,
      cornerstoneCacheService,
      customizationService,
      measurementService,
    } = servicesManager.services;

    const [viewportDialogState] = useViewportDialog();
    // useCallback for scroll bar height calculation
    const setImageScrollBarHeight = useCallback(() => {
      const scrollbarHeight = `${elementRef.current.clientHeight - 10}px`;
      setScrollbarHeight(scrollbarHeight);
    }, [elementRef]);

    // useCallback for onResize
    const onResize = useCallback(
      (entries: ResizeObserverEntry[]) => {
        if (elementRef.current && entries?.length) {
          const entry = entries[0];
          const { width, height } = entry.contentRect;

          // If the element has no size (e.g. tab in background, display:none), clear the
          // cached dimensions so the next time we have a real size, resize runs. Otherwise
          // the cache still holds the old width/height, hasDimensionsChanged is false when the
          // tab becomes active again, and the rendering engine is never told to recover — a
          // common cause of a persistent black viewport after multi-tab or panel switching.
          if (width === 0 || height === 0) {
            viewportDimensions.delete(viewportId);
            return;
          }

          const prevDimensions = viewportDimensions.get(viewportId) || { width: 0, height: 0 };

          // Check if dimensions actually changed and then only resize if they have changed
          const hasDimensionsChanged =
            prevDimensions.width !== width || prevDimensions.height !== height;

          if (hasDimensionsChanged) {
            viewportDimensions.set(viewportId, { width, height });
            // Perform resize operations
            cornerstoneViewportService.resize();
            setImageScrollBarHeight();
          }
        }
      },
      [viewportId, elementRef, cornerstoneViewportService, setImageScrollBarHeight]
    );

    useEffect(() => {
      const element = elementRef.current;
      if (!element) {
        return;
      }

      const resizeObserver = new ResizeObserver(onResize);
      resizeObserver.observe(element);

      // Cleanup function
      return () => {
        resizeObserver.unobserve(element);
        resizeObserver.disconnect();
      };
    }, [onResize]);

    // When returning from a hidden tab, layout size may match the cache (so ResizeObserver
    // does not run a "changed" callback), but the WebGL/canvas can still need a full resize+render.
    // Ref-count: one document listener for all viewports, removed when none remain.
    useEffect(() => {
      if (typeof document === 'undefined') {
        return;
      }

      documentVisibilityRefCount += 1;
      if (documentVisibilityRefCount === 1) {
        documentVisibilityHandler = () => {
          if (document.visibilityState !== 'visible') {
            return;
          }
          // After many tabs, the browser can revoke this tab's WebGL context; resize alone
          // cannot fix stale GPU objects. Recover first, then resize.
          requestAnimationFrame(() => {
            void (async () => {
              cornerstoneViewportService.markWebGlContextPossiblyLost();
              await cornerstoneViewportService.recoverRenderingAfterWebGlContextLoss();
              cornerstoneViewportService.resize();
            })();
          });
        };
        document.addEventListener('visibilitychange', documentVisibilityHandler);
      }

      return () => {
        documentVisibilityRefCount -= 1;
        if (documentVisibilityRefCount === 0 && documentVisibilityHandler) {
          document.removeEventListener('visibilitychange', documentVisibilityHandler);
          documentVisibilityHandler = null;
        }
      };
    }, [cornerstoneViewportService]);

    const cleanUpServices = useCallback(
      viewportInfo => {
        const renderingEngineId = viewportInfo.getRenderingEngineId();
        const syncGroups = viewportInfo.getSyncGroups();

        toolGroupService.removeViewportFromToolGroup(viewportId, renderingEngineId);
        syncGroupService.removeViewportFromSyncGroup(viewportId, renderingEngineId, syncGroups);

        segmentationService.clearSegmentationRepresentations(viewportId);
      },
      [viewportId, segmentationService, syncGroupService, toolGroupService]
    );

    const elementEnabledHandler = useCallback(
      evt => {
        // check this is this element reference and return early if doesn't match
        if (evt.detail.element !== elementRef.current) {
          return;
        }

        const { viewportId, element } = evt.detail;
        const viewportInfo = cornerstoneViewportService.getViewportInfo(viewportId);

        if (!viewportInfo) {
          return;
        }

        setEnabledElement(viewportId, element);
        setEnabledVPElement(element);

        // IMAGE_RENDERED is dispatched on the viewport element only. Subscribing in a useEffect
        // keyed on enabledVPElement runs after React's state flush and can miss the first render.
        if (imageRenderedCleanupRef.current) {
          imageRenderedCleanupRef.current();
          imageRenderedCleanupRef.current = null;
        }
        const onImageRendered = (e: Event) => {
          if (hasReportedFirstImageRef.current) {
            return;
          }
          const vid = (e as CustomEvent)?.detail?.viewportId;
          if (vid !== undefined && vid !== viewportId) {
            return;
          }
          hasReportedFirstImageRef.current = true;
          const cb = onFirstImageRenderedRef.current;
          if (typeof cb === 'function') {
            cb();
          }
        };
        element.addEventListener(EVENTS.IMAGE_RENDERED, onImageRendered);
        imageRenderedCleanupRef.current = () => {
          element.removeEventListener(EVENTS.IMAGE_RENDERED, onImageRendered);
        };

        const renderingEngineId = viewportInfo.getRenderingEngineId();
        const toolGroupId = viewportInfo.getToolGroupId();
        const syncGroups = viewportInfo.getSyncGroups();

        toolGroupService.addViewportToToolGroup(viewportId, renderingEngineId, toolGroupId);

        syncGroupService.addViewportToSyncGroup(viewportId, renderingEngineId, syncGroups);

        // we don't need reactivity here so just use state
        const { synchronizersStore } = useSynchronizersStore.getState();
        if (synchronizersStore?.[viewportId]?.length && !isHangingProtocolLayout) {
          // If the viewport used to have a synchronizer, re apply it again
          _rehydrateSynchronizers(viewportId, syncGroupService);
        }

        if (onElementEnabled && typeof onElementEnabled === 'function') {
          onElementEnabled(evt);
        }
      },
      [viewportId, onElementEnabled, toolGroupService]
    );

    // disable the element upon unmounting
    useEffect(() => {
      cornerstoneViewportService.enableViewport(viewportId, elementRef.current);

      eventTarget.addEventListener(Enums.Events.ELEMENT_ENABLED, elementEnabledHandler);

      setImageScrollBarHeight();

      // Embed hosts often assign iframe height after first paint; retry resize so canvas is not stuck black.
      const resizeTimers = [0, 100, 400].map(ms =>
        window.setTimeout(() => cornerstoneViewportService.resize(), ms)
      );
      const blankRecoverTimers = [700, 1400, 2400].map(ms =>
        window.setTimeout(() => {
          if (hasReportedFirstImageRef.current) {
            return;
          }

          recoverBlankStackViewport(cornerstoneViewportService, viewportId);
        }, ms)
      );

      return () => {
        resizeTimers.forEach(clearTimeout);
        blankRecoverTimers.forEach(clearTimeout);
        if (imageRenderedCleanupRef.current) {
          imageRenderedCleanupRef.current();
          imageRenderedCleanupRef.current = null;
        }

        const viewportInfo = cornerstoneViewportService.getViewportInfo(viewportId);

        if (!viewportInfo) {
          return;
        }

        cornerstoneViewportService.storePresentation({ viewportId });

        // This should be done after the store presentation since synchronizers
        // will get cleaned up and they need the viewportInfo to be present
        cleanUpServices(viewportInfo);

        if (onElementDisabled && typeof onElementDisabled === 'function') {
          onElementDisabled(viewportInfo);
        }

        cornerstoneViewportService.disableElement(viewportId);
        viewportRef.unregister();

        eventTarget.removeEventListener(Enums.Events.ELEMENT_ENABLED, elementEnabledHandler);
      };
    }, []);

    // Mark viewport ready when viewport data is actually set (e.g. volume loaded).
    // ELEMENT_ENABLED fires when the element is added to the DOM; VIEWPORT_DATA_CHANGED
    // fires when _setDisplaySets (and thus volume/stack data) has finished.
    // Fallback: when switching layouts (single → MPR / axial primary) with cached data,
    // one viewport's displaySetPromise can resolve after the others; retry so we don't get stuck "Preparing view".
    useEffect(() => {
      hasMarkedReadyRef.current = false;
      const markReady = () => {
        if (hasMarkedReadyRef.current) return;
        hasMarkedReadyRef.current = true;
        if (onElementEnabled && typeof onElementEnabled === 'function') {
          onElementEnabled({ detail: { viewportId } });
        }
      };
      const { unsubscribe } = cornerstoneViewportService.subscribe(
        cornerstoneViewportService.EVENTS.VIEWPORT_DATA_CHANGED,
        ({ viewportId: changedViewportId }) => {
          if (changedViewportId === viewportId) {
            markReady();
          }
        }
      );
      const delays = [200, 450, 800, 1200, 1800];
      const timers: number[] = [];
      delays.forEach(delay => {
        const t = window.setTimeout(() => {
          if (hasMarkedReadyRef.current) return;
          try {
            const viewportInfo = cornerstoneViewportService.getViewportInfo(viewportId);
            if (viewportInfo?.getViewportData?.()) {
              markReady();
            }
          } catch {
            // viewport not registered yet
          }
        }, delay);
        timers.push(t);
      });
      return () => {
        unsubscribe();
        timers.forEach(t => window.clearTimeout(t));
      };
    }, [viewportId, onElementEnabled, cornerstoneViewportService]);

    // subscribe to displaySet metadata invalidation (updates)
    // Currently, if the metadata changes we need to re-render the display set
    // for it to take effect in the viewport. As we deal with scaling in the loading,
    // we need to remove the old volume from the cache, and let the
    // viewport to re-add it which will use the new metadata. Otherwise, the
    // viewport will use the cached volume and the new metadata will not be used.
    // Note: this approach does not actually end of sending network requests
    // and it uses the network cache
    useEffect(() => {
      const { unsubscribe } = displaySetService.subscribe(
        displaySetService.EVENTS.DISPLAY_SET_SERIES_METADATA_INVALIDATED,
        async ({
          displaySetInstanceUID: invalidatedDisplaySetInstanceUID,
          invalidateData,
        }: Types.DisplaySetSeriesMetadataInvalidatedEvent) => {
          if (!invalidateData) {
            return;
          }

          const viewportInfo = cornerstoneViewportService.getViewportInfo(viewportId);

          if (viewportInfo.hasDisplaySet(invalidatedDisplaySetInstanceUID)) {
            const viewportData = viewportInfo.getViewportData();
            const newViewportData = await cornerstoneCacheService.invalidateViewportData(
              viewportData,
              invalidatedDisplaySetInstanceUID,
              dataSource,
              displaySetService
            );

            const keepCamera = true;
            cornerstoneViewportService.updateViewport(viewportId, newViewportData, keepCamera);
          }
        }
      );
      return () => {
        unsubscribe();
      };
    }, [viewportId]);

    useEffect(() => {
      // handle the default viewportType to be stack
      if (!viewportOptions.viewportType) {
        viewportOptions.viewportType = STACK;
      }

      hasReportedFirstImageRef.current = false;

      // Layout change (e.g. MPR → single on double-click) resets isReady in grid state.
      // Allow this viewport to mark ready again when VIEWPORT_DATA_CHANGED fires.
      hasMarkedReadyRef.current = false;

      const displaySetUIDs = displaySets
        .map(ds => ds.displaySetInstanceUID)
        .sort()
        .join(',');
      const newOrientation = viewportOptions.orientation;
      const prev = prevViewportDepsRef.current;
      prevViewportDepsRef.current = { orientation: newOrientation, displaySetUIDs };

      // When only orientation changed (e.g. from setViewportOrientation command in MPR),
      // update the existing viewport instead of re-running loadViewportData. Full reload
      // can leave viewports black or broken (see OHIF #3486, #5147).
      if (
        prev &&
        prev.displaySetUIDs === displaySetUIDs &&
        prev.orientation !== newOrientation &&
        viewportOptions.viewportType === 'volume'
      ) {
        try {
          const viewport = cornerstoneViewportService.getCornerstoneViewport(viewportId);
          const viewportInfo = cornerstoneViewportService.getViewportInfo(viewportId);
          if (
            viewport &&
            viewportInfo &&
            viewport.type === Enums.ViewportType.ORTHOGRAPHIC &&
            viewportInfo.getViewportData?.()
          ) {
            viewport.setOrientation(newOrientation as Enums.OrientationAxis);
            if (typeof viewport.resetCamera === 'function') {
              viewport.resetCamera();
            }
            cornerstoneViewportService.safeRenderViewport(viewport);
            viewportInfo.setOrientation(newOrientation as Enums.OrientationAxis);
            return;
          }
        } catch {
          // fall through to full loadViewportData
        }
      }

      const loadViewportData = async () => {
        await cornerstoneViewportService.recoverRenderingAfterWebGlContextLoss();

        const viewportData = await cornerstoneCacheService.createViewportData(
          displaySets,
          viewportOptions,
          dataSource,
          initialImageIndex
        );

        const presentations = getViewportPresentations(viewportId, viewportOptions);

        // Note: This is a hack to get the grid to re-render the OHIFCornerstoneViewport component
        // Used for segmentation hydration right now, since the logic to decide whether
        // a viewport needs to render a segmentation lives inside the CornerstoneViewportService
        // so we need to re-render (force update via change of the needsRerendering) so that React
        // does the diffing and decides we should render this again (although the id and element has not changed)
        // so that the CornerstoneViewportService can decide whether to render the segmentation or not. Not that we reached here we can turn it off.
        if (viewportOptions.needsRerendering) {
          viewportOptions.needsRerendering = false;
        }

        cornerstoneViewportService.setViewportData(
          viewportId,
          viewportData,
          viewportOptions,
          displaySetOptions,
          presentations
        );
      };

      loadViewportData();
    }, [viewportOptions, displaySets, dataSource]);

    const Notification = customizationService.getCustomization('ui.notificationComponent');

    return (
      <React.Fragment>
        <div className="viewport-wrapper">
          <div
            className="cornerstone-viewport-element"
            style={{ height: '100%', width: '100%' }}
            onContextMenu={e => e.preventDefault()}
            onMouseDown={e => e.preventDefault()}
            data-viewportid={viewportId}
            ref={el => {
              elementRef.current = el;
              if (el) {
                viewportRef.register(el);
              }
            }}
          ></div>
          <CornerstoneOverlays
            viewportId={viewportId}
            toolBarService={toolbarService}
            element={elementRef.current}
            scrollbarHeight={scrollbarHeight}
            servicesManager={servicesManager}
          />
          <CinePlayer
            enabledVPElement={enabledVPElement}
            viewportId={viewportId}
            servicesManager={servicesManager}
          />
          <ActiveViewportBehavior
            viewportId={viewportId}
            servicesManager={servicesManager}
          />
        </div>
        {/* top offset of 24px to account for ViewportActionCorners. */}
        <div className="absolute top-[24px] w-full">
          {viewportDialogState.viewportId === viewportId && (
            <Notification
              id="viewport-notification"
              message={viewportDialogState.message}
              type={viewportDialogState.type}
              actions={viewportDialogState.actions}
              onSubmit={viewportDialogState.onSubmit}
              onOutsideClick={viewportDialogState.onOutsideClick}
              onKeyPress={viewportDialogState.onKeyPress}
            />
          )}
        </div>
        {/* The OHIFViewportActionCorners follows the viewport in the DOM so that it is naturally at a higher z-index.*/}
        <OHIFViewportActionCorners viewportId={viewportId} />
      </React.Fragment>
    );
  },
  areEqual
);

function _rehydrateSynchronizers(viewportId: string, syncGroupService: any) {
  const { synchronizersStore } = useSynchronizersStore.getState();
  const synchronizers = synchronizersStore[viewportId];

  if (!synchronizers) {
    return;
  }

  synchronizers.forEach(synchronizerObj => {
    if (!synchronizerObj.id) {
      return;
    }

    const { id, sourceViewports, targetViewports } = synchronizerObj;

    const synchronizer = syncGroupService.getSynchronizer(id);

    if (!synchronizer) {
      return;
    }

    const sourceViewportInfo = sourceViewports.find(
      sourceViewport => sourceViewport.viewportId === viewportId
    );

    const targetViewportInfo = targetViewports.find(
      targetViewport => targetViewport.viewportId === viewportId
    );

    const isSourceViewportInSynchronizer = synchronizer
      .getSourceViewports()
      .find(sourceViewport => sourceViewport.viewportId === viewportId);

    const isTargetViewportInSynchronizer = synchronizer
      .getTargetViewports()
      .find(targetViewport => targetViewport.viewportId === viewportId);

    // if the viewport was previously a source viewport, add it again
    if (sourceViewportInfo && !isSourceViewportInSynchronizer) {
      synchronizer.addSource({
        viewportId: sourceViewportInfo.viewportId,
        renderingEngineId: sourceViewportInfo.renderingEngineId,
      });
    }

    // if the viewport was previously a target viewport, add it again
    if (targetViewportInfo && !isTargetViewportInSynchronizer) {
      synchronizer.addTarget({
        viewportId: targetViewportInfo.viewportId,
        renderingEngineId: targetViewportInfo.renderingEngineId,
      });
    }
  });
}

// Component displayName
OHIFCornerstoneViewport.displayName = 'OHIFCornerstoneViewport';

function areEqual(prevProps, nextProps) {
  if (nextProps.needsRerendering) {
    return false;
  }

  if (prevProps.displaySets.length !== nextProps.displaySets.length) {
    return false;
  }

  if (prevProps.viewportOptions.orientation !== nextProps.viewportOptions.orientation) {
    return false;
  }

  if (prevProps.viewportOptions.toolGroupId !== nextProps.viewportOptions.toolGroupId) {
    return false;
  }

  if (
    nextProps.viewportOptions.viewportType &&
    prevProps.viewportOptions.viewportType !== nextProps.viewportOptions.viewportType
  ) {
    return false;
  }

  if (nextProps.viewportOptions.needsRerendering) {
    return false;
  }

  const prevDisplaySets = prevProps.displaySets;
  const nextDisplaySets = nextProps.displaySets;

  if (prevDisplaySets.length !== nextDisplaySets.length) {
    return false;
  }

  for (let i = 0; i < prevDisplaySets.length; i++) {
    const prevDisplaySet = prevDisplaySets[i];

    const foundDisplaySet = nextDisplaySets.find(
      nextDisplaySet =>
        nextDisplaySet.displaySetInstanceUID === prevDisplaySet.displaySetInstanceUID
    );

    if (!foundDisplaySet) {
      return false;
    }

    // check they contain the same image
    if (foundDisplaySet.images?.length !== prevDisplaySet.images?.length) {
      return false;
    }

    // check if their imageIds are the same
    if (foundDisplaySet.images?.length) {
      for (let j = 0; j < foundDisplaySet.images.length; j++) {
        if (foundDisplaySet.images[j].imageId !== prevDisplaySet.images[j].imageId) {
          return false;
        }
      }
    }
  }

  return true;
}

export default OHIFCornerstoneViewport;
