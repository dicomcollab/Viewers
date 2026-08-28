import React, { useEffect, useState, useCallback, useRef } from 'react';
import { SidePanel } from '@ohif/ui-next';
import { Types } from '@ohif/core';
import {
  getViewerLayoutSync,
  isPanelRestoreLocked,
  isPersistViewerLayoutEnabled,
  mergeAndSaveViewerLayout,
  resolveTabIndex,
  subscribeViewerLayoutLoaded,
} from '../utils/viewerLayoutPreferences';

export type SidePanelWithServicesProps = {
  servicesManager: AppTypes.ServicesManager;
  side: 'left' | 'right';
  className?: string;
  activeTabIndex: number;
  tabs?: any;
  expandedWidth?: number;
  onClose: () => void;
  onOpen: () => void;
  isExpanded: boolean;
  collapsedWidth?: number;
  expandedInsideBorderSize?: number;
  collapsedInsideBorderSize?: number;
  collapsedOutsideBorderSize?: number;
};

const SidePanelWithServices = ({
  servicesManager,
  side,
  activeTabIndex: activeTabIndexProp,
  isExpanded,
  tabs: tabsProp,
  onOpen,
  onClose,
  ...props
}: SidePanelWithServicesProps) => {
  const { panelService, toolbarService, viewportGridService } = servicesManager.services;

  // Tracks whether the user manually closed this panel (for ACTIVATE_PANEL behavior).
  const [closedManually, setClosedManually] = useState(
    () => getViewerLayoutSync()?.[side === 'left' ? 'leftPanel' : 'rightPanel']?.closed === true
  );
  const [tabs, setTabs] = useState(tabsProp ?? panelService.getPanels(side));
  const [activeTabIndex, setActiveTabIndex] = useState(() => {
    const saved = getViewerLayoutSync()?.[side === 'left' ? 'leftPanel' : 'rightPanel'];
    const fromSaved = resolveTabIndex(tabsProp ?? panelService.getPanels(side), saved);
    return fromSaved ?? activeTabIndexProp ?? 0;
  });
  const tabRestoredRef = useRef(false);

  const handleActiveTabIndexChange = useCallback(
    ({ activeTabIndex: nextIndex }) => {
      const { activeViewportId: viewportId } = viewportGridService.getState();
      toolbarService.refreshToolbarState({ viewportId });

      setActiveTabIndex(nextIndex);
      const tab = tabs[nextIndex];
      mergeAndSaveViewerLayout({
        [side === 'left' ? 'leftPanel' : 'rightPanel']: {
          tabIndex: nextIndex,
          ...(tab?.id ? { tabId: tab.id } : {}),
        },
      });
    },
    [toolbarService, viewportGridService, tabs, side]
  );

  const handleOpen = useCallback(() => {
    onOpen?.();
  }, [onOpen]);

  const handleClose = useCallback(() => {
    setClosedManually(true);
    onClose?.();
  }, [onClose]);

  useEffect(() => {
    setClosedManually(!isExpanded);
  }, [isExpanded]);

  /** Keep restored tab when parent does not pass an index. */
  useEffect(() => {
    if (activeTabIndexProp === undefined || activeTabIndexProp === null) {
      return;
    }
    setActiveTabIndex(activeTabIndexProp);
  }, [activeTabIndexProp]);

  useEffect(() => {
    const { unsubscribe } = panelService.subscribe(
      panelService.EVENTS.PANELS_CHANGED,
      panelChangedEvent => {
        if (panelChangedEvent.position !== side) {
          return;
        }

        setTabs(panelService.getPanels(side));
      }
    );

    return () => {
      unsubscribe();
    };
  }, [panelService, side]);

  useEffect(() => {
    const activatePanelSubscription = panelService.subscribe(
      panelService.EVENTS.ACTIVATE_PANEL,
      (activatePanelEvent: Types.ActivatePanelEvent) => {
        if (isPanelRestoreLocked()) {
          return;
        }
        if (!isExpanded && !activatePanelEvent.forceExpand) {
          return;
        }
        if (isExpanded || activatePanelEvent.forceActive) {
          const tabIndex = tabs.findIndex(tab => tab.id === activatePanelEvent.panelId);
          if (tabIndex !== -1) {
            if (!closedManually || activatePanelEvent.forceExpand) {
              onOpen?.();
              setClosedManually(false);
            }
            setActiveTabIndex(tabIndex);
          }
        }
      }
    );

    return () => {
      activatePanelSubscription.unsubscribe();
    };
  }, [tabs, panelService, closedManually, isExpanded, onOpen]);

  useEffect(() => {
    const unsubscribe = subscribeViewerLayoutLoaded(layout => {
      if (!isPersistViewerLayoutEnabled() || tabRestoredRef.current || !tabs?.length) {
        return;
      }
      const saved = layout?.[side === 'left' ? 'leftPanel' : 'rightPanel'];
      const fromSaved = resolveTabIndex(tabs, saved);
      if (fromSaved != null) {
        setActiveTabIndex(fromSaved);
        tabRestoredRef.current = true;
      }
    });
    return unsubscribe;
  }, [side, tabs]);

  return (
    <SidePanel
      {...props}
      side={side}
      tabs={tabs}
      activeTabIndex={activeTabIndex}
      isExpanded={isExpanded}
      onOpen={handleOpen}
      onClose={handleClose}
      onActiveTabIndexChange={handleActiveTabIndexChange}
    />
  );
};

export default SidePanelWithServices;
