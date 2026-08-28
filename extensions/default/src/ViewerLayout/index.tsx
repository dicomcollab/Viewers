import React, { useEffect, useLayoutEffect, useState, useCallback, useRef } from 'react';
import PropTypes from 'prop-types';

import { HangingProtocolService, CommandsManager } from '@ohif/core';
import { useAppConfig } from '@state';
import ViewerHeader from './ViewerHeader';
import ViewerHpCineBar from './ViewerHpCineBar';
import SidePanelWithServices from '../Components/SidePanelWithServices';
import { Onboarding, ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@ohif/ui-next';
import useResizablePanels from './ResizablePanelsHook';
import useViewerLayoutPersistence from '../hooks/useViewerLayoutPersistence';
import {
  getViewerLayoutSync,
  hasExplicitViewerLayout,
  isPersistViewerLayoutEnabled,
  isViewerLayoutHydrated,
  seedDefaultClosedPanels,
  setPanelRestoreLocked,
  subscribeViewerLayoutLoaded,
} from '../utils/viewerLayoutPreferences';
import './ViewerLayout.css';

const resizableHandleClassName = 'mt-[1px] bg-black';

/** Tablet landscape and below; desktop layouts stay wider. */
const MOBILE_TABLET_MAX_WIDTH_PX = 1024;

const isInIframe = () => {
  try {
    return window.self !== window.top;
  } catch (e) {
    return true;
  }
};

/** iPadOS 13+ may report as Mac; still treat as tablet when touch-capable. */
const isIPad = () =>
  typeof navigator !== 'undefined' &&
  (/iPad/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));

/**
 * Phones and tablets only — not desktop browsers with a narrow window.
 * Uses touch-primary media queries plus viewport width (and iPad fallback).
 */
const isMobileOrTabletScreen = () => {
  if (typeof window === 'undefined') {
    return false;
  }

  const withinMobileTabletWidth = window.matchMedia(
    `(max-width: ${MOBILE_TABLET_MAX_WIDTH_PX}px)`
  ).matches;

  if (!withinMobileTabletWidth) {
    return false;
  }

  if (isIPad()) {
    return true;
  }

  return window.matchMedia('(hover: none), (pointer: coarse)').matches;
};

/** Close both sidebars by default only when embedded or on a mobile/tablet device. */
const shouldDefaultPanelsClosed = () => isInIframe() || isMobileOrTabletScreen();

function ViewerLayout({
  // From Extension Module Params
  extensionManager,
  servicesManager,
  hotkeysManager,
  commandsManager,
  // From Modes
  viewports,
  ViewportGridComp,
  leftPanelClosed = false,
  rightPanelClosed = false,
  leftPanelResizable = false,
  rightPanelResizable = false,
  leftPanelInitialExpandedWidth,
  rightPanelInitialExpandedWidth,
  leftPanelMinimumExpandedWidth,
  rightPanelMinimumExpandedWidth,
}: withAppTypes): React.FunctionComponent {
  const [appConfig] = useAppConfig();

  const { panelService, hangingProtocolService, customizationService } = servicesManager.services;
  const [showLoadingIndicator, setShowLoadingIndicator] = useState(appConfig.showLoadingIndicator);

  const isIframeMode = isInIframe();
  const defaultPanelsClosed = shouldDefaultPanelsClosed();
  if (defaultPanelsClosed && !hasExplicitViewerLayout()) {
    seedDefaultClosedPanels();
  }
  const savedViewerLayout = getViewerLayoutSync();
  const layoutHydrated = isViewerLayoutHydrated();
  const hasSavedLayout = isPersistViewerLayoutEnabled() && hasExplicitViewerLayout();
  // Do not expand on first paint before preferences load — that fights a saved closed panel.
  const effectiveLeftPanelClosed = !layoutHydrated
    ? true
    : hasSavedLayout
      ? savedViewerLayout.leftPanel.closed === true
      : defaultPanelsClosed
        ? true
        : typeof savedViewerLayout?.leftPanel?.closed === 'boolean'
          ? savedViewerLayout.leftPanel.closed
          : leftPanelClosed;
  const effectiveRightPanelClosed = !layoutHydrated
    ? true
    : hasSavedLayout
      ? savedViewerLayout.rightPanel.closed === true
      : defaultPanelsClosed
        ? true
        : typeof savedViewerLayout?.rightPanel?.closed === 'boolean'
          ? savedViewerLayout.rightPanel.closed
          : rightPanelClosed;
  const restoredLeftPanelWidth = savedViewerLayout?.leftPanel?.width;
  const restoredRightPanelWidth = savedViewerLayout?.rightPanel?.width;

  const hasPanels = useCallback(
    (side): boolean => !!panelService.getPanels(side).length,
    [panelService]
  );

  const [hasRightPanels, setHasRightPanels] = useState(hasPanels('right'));
  const [hasLeftPanels, setHasLeftPanels] = useState(hasPanels('left'));
  const [leftPanelClosedState, setLeftPanelClosed] = useState(effectiveLeftPanelClosed);
  const [rightPanelClosedState, setRightPanelClosed] = useState(effectiveRightPanelClosed);

  const { persistPanelChange } = useViewerLayoutPersistence({
    servicesManager,
    commandsManager,
  });
  const applyingSavedPanelsRef = useRef(true);
  const userAdjustedPanelsRef = useRef(false);
  const applyGenerationRef = useRef(0);

  const setLeftPanelClosedAndPersist = useCallback(
    (closed, options) => {
      if (options?.persist === false && userAdjustedPanelsRef.current && closed === false) {
        return;
      }
      setLeftPanelClosed(closed);
      if (options?.persist === false) {
        return;
      }
      userAdjustedPanelsRef.current = true;
      applyGenerationRef.current += 1;
      persistPanelChange(
        { leftPanel: { closed } },
        { userAction: true, debounceMs: 0, force: true }
      );
    },
    [persistPanelChange]
  );

  const setRightPanelClosedAndPersist = useCallback(
    (closed, options) => {
      if (options?.persist === false && userAdjustedPanelsRef.current && closed === false) {
        return;
      }
      setRightPanelClosed(closed);
      if (options?.persist === false) {
        return;
      }
      userAdjustedPanelsRef.current = true;
      applyGenerationRef.current += 1;
      persistPanelChange(
        { rightPanel: { closed } },
        { userAction: true, debounceMs: 0, force: true }
      );
    },
    [persistPanelChange]
  );

  const [
    leftPanelProps,
    rightPanelProps,
    resizablePanelGroupProps,
    resizableLeftPanelProps,
    resizableViewportGridPanelProps,
    resizableRightPanelProps,
    onHandleDragging,
    syncPanelClosed,
  ] = useResizablePanels(
    effectiveLeftPanelClosed,
    setLeftPanelClosedAndPersist,
    effectiveRightPanelClosed,
    setRightPanelClosedAndPersist,
    hasLeftPanels,
    hasRightPanels,
    restoredLeftPanelWidth || leftPanelInitialExpandedWidth,
    restoredRightPanelWidth || rightPanelInitialExpandedWidth,
    leftPanelMinimumExpandedWidth,
    isIframeMode ? (rightPanelMinimumExpandedWidth ?? 200) : rightPanelMinimumExpandedWidth
  );

  const skipFirstLeftWidthSaveRef = useRef(true);
  const skipFirstRightWidthSaveRef = useRef(true);

  useEffect(() => {
    if (skipFirstLeftWidthSaveRef.current) {
      skipFirstLeftWidthSaveRef.current = false;
      return;
    }
    if (applyingSavedPanelsRef.current) {
      return;
    }
    if (typeof leftPanelProps?.expandedWidth !== 'number') {
      return;
    }
    persistPanelChange(
      { leftPanel: { width: Math.round(leftPanelProps.expandedWidth) } },
      { debounceMs: 500, userAction: true }
    );
  }, [leftPanelProps?.expandedWidth, persistPanelChange]);

  useEffect(() => {
    if (skipFirstRightWidthSaveRef.current) {
      skipFirstRightWidthSaveRef.current = false;
      return;
    }
    if (applyingSavedPanelsRef.current) {
      return;
    }
    if (typeof rightPanelProps?.expandedWidth !== 'number') {
      return;
    }
    persistPanelChange(
      { rightPanel: { width: Math.round(rightPanelProps.expandedWidth) } },
      { debounceMs: 500, userAction: true }
    );
  }, [rightPanelProps?.expandedWidth, persistPanelChange]);

  const leftPanelPropsRef = useRef(leftPanelProps);
  const rightPanelPropsRef = useRef(rightPanelProps);
  const syncPanelClosedRef = useRef(syncPanelClosed);
  const hasLeftPanelsRef = useRef(hasLeftPanels);
  const hasRightPanelsRef = useRef(hasRightPanels);
  leftPanelPropsRef.current = leftPanelProps;
  rightPanelPropsRef.current = rightPanelProps;
  syncPanelClosedRef.current = syncPanelClosed;
  hasLeftPanelsRef.current = hasLeftPanels;
  hasRightPanelsRef.current = hasRightPanels;

  const handlePanelDragging = useCallback(
    isStartDrag => {
      onHandleDragging(isStartDrag);
      if (isStartDrag || applyingSavedPanelsRef.current) {
        return;
      }
      const leftWidth = leftPanelPropsRef.current?.expandedWidth;
      const rightWidth = rightPanelPropsRef.current?.expandedWidth;
      persistPanelChange(
        {
          ...(typeof leftWidth === 'number' ? { leftPanel: { width: Math.round(leftWidth) } } : {}),
          ...(typeof rightWidth === 'number' ? { rightPanel: { width: Math.round(rightWidth) } } : {}),
        },
        { debounceMs: 0, userAction: true }
      );
    },
    [onHandleDragging, persistPanelChange]
  );

  useEffect(() => {
    setPanelRestoreLocked(true);
    applyingSavedPanelsRef.current = true;
    let unlockTimer = 0;
    let resizeObserver = null;
    const retryTimers = [];

    const unlock = () => {
      applyingSavedPanelsRef.current = false;
      setPanelRestoreLocked(false);
      retryTimers.forEach(clearTimeout);
      retryTimers.length = 0;
      resizeObserver?.disconnect();
      resizeObserver = null;
    };

    const apply = layout => {
      if (userAdjustedPanelsRef.current) {
        unlock();
        return;
      }
      if (!layout?.leftPanel && !layout?.rightPanel) {
        unlock();
        return;
      }
      applyingSavedPanelsRef.current = true;
      setPanelRestoreLocked(true);
      const generation = ++applyGenerationRef.current;
      const leftClosed = layout.leftPanel?.closed === true;
      const rightClosed = layout.rightPanel?.closed === true;
      setLeftPanelClosed(leftClosed);
      setRightPanelClosed(rightClosed);

      const trySync = () => {
        if (userAdjustedPanelsRef.current || generation !== applyGenerationRef.current) {
          return true;
        }
        const leftOk =
          !hasLeftPanelsRef.current ||
          syncPanelClosedRef.current?.('left', leftClosed, layout.leftPanel?.width) === true;
        const rightOk =
          !hasRightPanelsRef.current ||
          syncPanelClosedRef.current?.('right', rightClosed, layout.rightPanel?.width) === true;
        return leftOk && rightOk;
      };

      retryTimers.forEach(clearTimeout);
      retryTimers.length = 0;
      if (unlockTimer) {
        clearTimeout(unlockTimer);
        unlockTimer = 0;
      }

      const schedule = () => {
        if (userAdjustedPanelsRef.current || generation !== applyGenerationRef.current) {
          unlock();
          return;
        }
        if (trySync()) {
          unlockTimer = window.setTimeout(() => {
            if (generation === applyGenerationRef.current && !userAdjustedPanelsRef.current) {
              unlock();
            }
          }, 400);
        }
      };

      schedule();
      [50, 150, 300, 600, 1000, 1600, 2500].forEach(ms => {
        retryTimers.push(window.setTimeout(schedule, ms));
      });
      unlockTimer = window.setTimeout(() => {
        if (generation === applyGenerationRef.current) {
          unlock();
        }
      }, 3000);

      const groupEl = document.querySelector(
        '[data-panel-group-id="viewerLayoutResizablePanelGroup"]'
      );
      resizeObserver?.disconnect();
      if (groupEl && typeof ResizeObserver !== 'undefined') {
        resizeObserver = new ResizeObserver(() => {
          if (userAdjustedPanelsRef.current || generation !== applyGenerationRef.current) {
            resizeObserver?.disconnect();
            return;
          }
          schedule();
        });
        resizeObserver.observe(groupEl);
      }
    };

    const unsubscribe = subscribeViewerLayoutLoaded(layout => {
      apply(layout);
    });
    return () => {
      retryTimers.forEach(clearTimeout);
      if (unlockTimer) {
        clearTimeout(unlockTimer);
      }
      resizeObserver?.disconnect();
      unsubscribe();
      setPanelRestoreLocked(false);
    };
  }, []);

  const handleMouseEnter = () => {
    (document.activeElement as HTMLElement)?.blur();
  };

  const LoadingIndicatorProgress = customizationService.getCustomization(
    'ui.loadingIndicatorProgress'
  );

  /**
   * Set body classes (tailwindcss) that don't allow vertical
   * or horizontal overflow (no scrolling). Also guarantee window
   * is sized to our viewport.
   */
  useEffect(() => {
    document.body.classList.add('bg-black');
    document.body.classList.add('overflow-hidden');

    return () => {
      document.body.classList.remove('bg-black');
      document.body.classList.remove('overflow-hidden');
    };
  }, []);

  useLayoutEffect(() => {
    if (!isIframeMode) {
      return;
    }

    document.documentElement.classList.add('ohif-iframe-embed');
    document.body.classList.add('ohif-iframe-embed');

    return () => {
      document.documentElement.classList.remove('ohif-iframe-embed');
      document.body.classList.remove('ohif-iframe-embed');
    };
  }, [isIframeMode]);

  /**
   * Iframe: Cornerstone ignores resize at 0×0. Production embeds often settle layout after
   * first paint, and ViewportGrid mounts only after hanging protocol assigns rows/cols — so
   * we poll for the grid, listen for layout/viewport-ready events, and retry resize.
   */
  useEffect(() => {
    if (!isIframeMode) {
      return;
    }

    const {
      cornerstoneViewportService,
      hangingProtocolService: hpService,
      viewportGridService,
    } = servicesManager.services;

    if (!cornerstoneViewportService?.resize) {
      return;
    }

    let disposed = false;
    let gridObserver: ResizeObserver | null = null;
    let gridPollId: ReturnType<typeof setInterval> | null = null;

    const scheduleResize = () => {
      if (disposed) {
        return;
      }
      requestAnimationFrame(() => {
        if (disposed) {
          return;
        }
        try {
          cornerstoneViewportService.resize();
        } catch (e) {
          console.warn('[ViewerLayout] iframe cornerstone resize failed:', e);
        }
      });
    };

    const attachGridObserver = () => {
      if (gridObserver) {
        return true;
      }
      const gridEl = document.querySelector('[data-cy="viewport-grid-container"]');
      if (!gridEl) {
        return false;
      }
      gridObserver = new ResizeObserver(scheduleResize);
      gridObserver.observe(gridEl);
      scheduleResize();
      return true;
    };

    scheduleResize();
    const timers = [50, 150, 400, 800, 1500, 3000, 5000].map(ms =>
      window.setTimeout(scheduleResize, ms)
    );

    if (!attachGridObserver()) {
      gridPollId = setInterval(() => {
        if (attachGridObserver() && gridPollId) {
          clearInterval(gridPollId);
          gridPollId = null;
        }
      }, 200);
    }

    const onWindowResize = () => scheduleResize();
    window.addEventListener('resize', onWindowResize);

    const subscriptions = [
      hpService.subscribe(HangingProtocolService.EVENTS.PROTOCOL_CHANGED, scheduleResize),
      viewportGridService?.subscribe?.(viewportGridService.EVENTS.VIEWPORTS_READY, scheduleResize),
      viewportGridService?.subscribe?.(viewportGridService.EVENTS.LAYOUT_CHANGED, scheduleResize),
      viewportGridService?.subscribe?.(
        viewportGridService.EVENTS.GRID_SIZE_CHANGED,
        scheduleResize
      ),
    ].filter(Boolean);

    return () => {
      disposed = true;
      timers.forEach(clearTimeout);
      if (gridPollId) {
        clearInterval(gridPollId);
      }
      gridObserver?.disconnect();
      window.removeEventListener('resize', onWindowResize);
      subscriptions.forEach(sub => sub?.unsubscribe?.());
    };
  }, [isIframeMode, servicesManager]);

  /** Hide startup overlay when viewports are ready (PROTOCOL_CHANGED alone can miss in slow prod loads). */
  useEffect(() => {
    if (!showLoadingIndicator) {
      return;
    }

    const { viewportGridService } = servicesManager.services;
    const hide = () => setShowLoadingIndicator(false);

    const subscriptions = [
      hangingProtocolService.subscribe(HangingProtocolService.EVENTS.PROTOCOL_CHANGED, hide),
      viewportGridService?.subscribe?.(viewportGridService.EVENTS.VIEWPORTS_READY, hide),
    ].filter(Boolean);

    const safetyTimer = window.setTimeout(hide, 15000);

    return () => {
      clearTimeout(safetyTimer);
      subscriptions.forEach(sub => sub?.unsubscribe?.());
    };
  }, [showLoadingIndicator, hangingProtocolService, servicesManager]);

  const getComponent = id => {
    const entry = extensionManager.getModuleEntry(id);

    if (!entry || !entry.component) {
      throw new Error(
        `${id} is not valid for an extension module or no component found from extension ${id}. Please verify your configuration or ensure that the extension is properly registered. It's also possible that your mode is utilizing a module from an extension that hasn't been included in its dependencies (add the extension to the "extensionDependencies" array in your mode's index.js file). Check the reference string to the extension in your Mode configuration`
      );
    }

    return { entry };
  };

  const getViewportComponentData = viewportComponent => {
    const { entry } = getComponent(viewportComponent.namespace);

    return {
      component: entry.component,
      isReferenceViewable: entry.isReferenceViewable,
      displaySetsToDisplay: viewportComponent.displaySetsToDisplay,
    };
  };

  useEffect(() => {
    const { unsubscribe } = panelService.subscribe(
      panelService.EVENTS.PANELS_CHANGED,
      ({ options }) => {
        setHasLeftPanels(hasPanels('left'));
        setHasRightPanels(hasPanels('right'));
        if (options?.leftPanelClosed !== undefined && !hasExplicitViewerLayout() && !userAdjustedPanelsRef.current) {
          setLeftPanelClosed(options.leftPanelClosed);
        }
        if (options?.rightPanelClosed !== undefined && !hasExplicitViewerLayout() && !userAdjustedPanelsRef.current) {
          setRightPanelClosed(options.rightPanelClosed);
        }
      }
    );

    return () => {
      unsubscribe();
    };
  }, [panelService, hasPanels]);

  const viewportComponents = viewports.map(getViewportComponentData);

  const headerHeight = isIframeMode ? 44 : 48;

  return (
    <div
      className={`ohif-viewer-layout-root flex w-full flex-col ${
        isIframeMode ? 'ohif-iframe-fixed-root min-h-0' : 'h-screen'
      }`}
    >
      <ViewerHeader
        hotkeysManager={hotkeysManager}
        extensionManager={extensionManager}
        servicesManager={servicesManager}
        appConfig={appConfig}
        isIframeMode={isIframeMode}
      />
      <div
        className="ohif-viewer-layout-main relative flex min-h-0 w-full flex-row flex-nowrap items-stretch overflow-hidden bg-black"
        style={isIframeMode ? undefined : { height: `calc(100vh - ${headerHeight}px)` }}
      >
        <React.Fragment>
          {showLoadingIndicator && <LoadingIndicatorProgress className="h-full w-full bg-black" />}
          <ResizablePanelGroup
            {...resizablePanelGroupProps}
            className="h-full min-h-0"
          >
            {/* LEFT SIDEPANELS — full height under header */}
            {hasLeftPanels ? (
              <>
                <ResizablePanel {...resizableLeftPanelProps}>
                  <SidePanelWithServices
                    side="left"
                    isExpanded={!leftPanelClosedState}
                    servicesManager={servicesManager}
                    {...leftPanelProps}
                  />
                </ResizablePanel>
                <ResizableHandle
                  onDragging={handlePanelDragging}
                  disabled={!leftPanelResizable}
                  className={resizableHandleClassName}
                />
              </>
            ) : null}
            {/* HP/cine strip + viewport grid — strip matches viewport column width only */}
            <ResizablePanel {...resizableViewportGridPanelProps}>
              <div className={`flex h-full flex-1 flex-col ${isIframeMode ? 'iframe-mode' : ''}`}>
                <ViewerHpCineBar
                  servicesManager={servicesManager}
                  commandsManager={commandsManager}
                  isIframeMode={isIframeMode}
                />
                <div
                  className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-black"
                  onMouseEnter={handleMouseEnter}
                >
                  <ViewportGridComp
                    servicesManager={servicesManager}
                    viewportComponents={viewportComponents}
                    commandsManager={commandsManager}
                  />
                </div>
              </div>
            </ResizablePanel>
            {hasRightPanels ? (
              <>
                <ResizableHandle
                  onDragging={handlePanelDragging}
                  disabled={!rightPanelResizable}
                  className={resizableHandleClassName}
                />
                <ResizablePanel {...resizableRightPanelProps}>
                  <SidePanelWithServices
                    side="right"
                    isExpanded={!rightPanelClosedState}
                    servicesManager={servicesManager}
                    {...rightPanelProps}
                  />
                </ResizablePanel>
              </>
            ) : null}
          </ResizablePanelGroup>
        </React.Fragment>
      </div>
      <Onboarding tours={customizationService.getCustomization('ohif.tours')} />
    </div>
  );
}

ViewerLayout.propTypes = {
  // From extension module params
  extensionManager: PropTypes.shape({
    getModuleEntry: PropTypes.func.isRequired,
  }).isRequired,
  commandsManager: PropTypes.instanceOf(CommandsManager),
  servicesManager: PropTypes.object.isRequired,
  // From modes
  leftPanels: PropTypes.array,
  rightPanels: PropTypes.array,
  leftPanelClosed: PropTypes.bool.isRequired,
  rightPanelClosed: PropTypes.bool.isRequired,
  /** Responsible for rendering our grid of viewports; provided by consuming application */
  children: PropTypes.oneOfType([PropTypes.node, PropTypes.func]).isRequired,
  viewports: PropTypes.array,
};

export default ViewerLayout;
