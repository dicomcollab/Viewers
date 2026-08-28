import { useCallback, useEffect, useRef } from 'react';
import {
  getActiveStudyUID,
  getHangingProtocolService,
  getPrimaryModality,
  getViewerLayoutSync,
  hasUrlHangingProtocolOverride,
  isJpegDataSourceActive,
  isStudyReadyForHangingProtocol,
  isVolumeProtocolId,
  loadViewerLayoutFromApi,
  mergeAndSaveViewerLayout,
  isViewerLayoutHydrated,
  resolveHangingProtocolToApply,
  savedHangingProtocolMatchesCurrent,
  subscribeViewerLayoutLoaded,
} from '../utils/viewerLayoutPreferences';

/**
 * Restores saved hanging protocol after auto-match when Preferences → Viewer
 * Layout is on. A single image instance always hangs 1×1 (even if persist is
 * off or a 1×2/2×2 was saved), without overwriting the saved preference.
 */
export default function useViewerLayoutPersistence({ servicesManager, commandsManager }) {
  const restoringHpRef = useRef(false);

  const applySavedHangingProtocol = useCallback(
    (layout, modality) => {
      if (hasUrlHangingProtocolOverride()) {
        return false;
      }
      if (!isStudyReadyForHangingProtocol(servicesManager)) {
        return false;
      }
      const saved = resolveHangingProtocolToApply(layout, modality, servicesManager);
      if (!saved || !commandsManager?.run) {
        return false;
      }
      if (savedHangingProtocolMatchesCurrent(saved, servicesManager)) {
        return false;
      }
      if (saved.kind === 'protocol') {
        if (isJpegDataSourceActive() && isVolumeProtocolId(saved.protocolId)) {
          return false;
        }
        restoringHpRef.current = true;
        try {
          const activeStudyUID = getActiveStudyUID(servicesManager);
          commandsManager.run({
            commandName: 'setHangingProtocol',
            commandOptions: {
              protocolId: saved.protocolId,
              silent: true,
              ...(activeStudyUID ? { activeStudyUID } : {}),
              ...(saved.stageId ? { stageId: saved.stageId } : {}),
            },
          });
          window.setTimeout(() => {
            restoringHpRef.current = false;
          }, 0);
          return true;
        } catch (error) {
          restoringHpRef.current = false;
          console.warn('[viewerLayout] Failed to restore hanging protocol', error);
          return false;
        }
      }
      if (saved.kind === 'grid') {
        restoringHpRef.current = true;
        try {
          commandsManager.run({
            commandName: 'setViewportGridLayout',
            commandOptions: {
              numRows: saved.numRows,
              numCols: saved.numCols,
            },
          });
          window.setTimeout(() => {
            restoringHpRef.current = false;
          }, 0);
          return true;
        } catch (error) {
          restoringHpRef.current = false;
          console.warn('[viewerLayout] Failed to restore grid layout', error);
          return false;
        }
      }
      return false;
    },
    [commandsManager, servicesManager]
  );

  const tryRestoreHp = useCallback(() => {
    applySavedHangingProtocol(getViewerLayoutSync(), getPrimaryModality(servicesManager));
  }, [applySavedHangingProtocol, servicesManager]);

  useEffect(() => {
    const hangingProtocolService = getHangingProtocolService(servicesManager);
    const viewportGridService = servicesManager?.services?.viewportGridService;
    const displaySetService = servicesManager?.services?.displaySetService;
    let cancelled = false;
    const timers = [];
    let restoreGeneration = 0;

    const scheduleRestore = () => {
      restoreGeneration += 1;
      const generation = restoreGeneration;
      [80, 400, 1000, 2000].forEach(ms => {
        timers.push(
          window.setTimeout(() => {
            if (!cancelled && generation === restoreGeneration) {
              tryRestoreHp();
            }
          }, ms)
        );
      });
    };

    loadViewerLayoutFromApi().then(() => {
      if (!cancelled) {
        scheduleRestore();
      }
    });

    const hpSubscription = hangingProtocolService?.subscribe?.(
      hangingProtocolService.EVENTS.PROTOCOL_CHANGED,
      () => {
        if (cancelled) {
          return;
        }
        if (restoringHpRef.current) {
          restoringHpRef.current = false;
          return;
        }
        scheduleRestore();
      }
    );

    const viewportSubscription = viewportGridService?.subscribe?.(
      viewportGridService.EVENTS.VIEWPORTS_READY,
      () => {
        if (!cancelled && !restoringHpRef.current) {
          scheduleRestore();
        }
      }
    );

    const displaySetSubscription = displaySetService?.subscribe?.(
      displaySetService.EVENTS.DISPLAY_SETS_ADDED,
      () => {
        if (!cancelled && !restoringHpRef.current) {
          scheduleRestore();
        }
      }
    );

    const unsubscribeLayout = subscribeViewerLayoutLoaded(() => {
      if (!cancelled) {
        scheduleRestore();
      }
    });

    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
      hpSubscription?.unsubscribe?.();
      viewportSubscription?.unsubscribe?.();
      displaySetSubscription?.unsubscribe?.();
      unsubscribeLayout?.();
    };
  }, [servicesManager, tryRestoreHp]);

  const persistPanelChange = useCallback((partial, options) => {
    if (!isViewerLayoutHydrated() && !options?.force) {
      return;
    }
    mergeAndSaveViewerLayout(partial, options);
  }, []);

  return {
    persistPanelChange,
    tryRestoreHp,
  };
}
