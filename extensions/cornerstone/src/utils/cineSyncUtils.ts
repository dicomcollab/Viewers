import { cache, Types } from '@cornerstonejs/core';

const CINE_SYNC_GROUP_TYPES = new Set(['frameview', 'imageslice', 'stackimage', 'image_slice']);

function _getVolumeFromViewport(viewport: Types.IBaseVolumeViewport) {
  const volumeIds = viewport.getAllVolumeIds();
  const volumes = volumeIds.map(id => cache.getVolume(id));
  const dynamicVolume = volumes.find(volume => volume.isDynamicVolume());

  return dynamicVolume ?? volumes[0];
}

function getUsDisplaySetFromViewport(displaySetService, viewportState) {
  const displaySetInstanceUIDs = viewportState?.displaySetInstanceUIDs ?? [];

  return displaySetInstanceUIDs
    .map(uid => displaySetService.getDisplaySetByUID(uid))
    .find(ds => ds?.Modality === 'US' && (ds?.numImageFrames ?? 0) > 0);
}

export function viewportSupportsCine(displaySetService, viewportState) {
  const displaySetInstanceUIDs = viewportState?.displaySetInstanceUIDs || [];

  return displaySetInstanceUIDs.some(uid => {
    const displaySet = displaySetService.getDisplaySetByUID(uid);

    if (!displaySet) {
      return false;
    }

    return displaySet.isDynamicVolume || (displaySet.numImageFrames ?? 0) > 1;
  });
}

const _viewportSupportsCine = viewportSupportsCine;

/**
 * Viewport ids that can play cine (multi-frame stacks or dynamic volumes).
 */
export function getCineCapableViewportIds(servicesManager: AppTypes.ServicesManager): string[] {
  const { viewportGridService, displaySetService } = servicesManager.services;
  const { viewports } = viewportGridService.getState();

  return Array.from(viewports.entries())
    .filter(([, viewportState]) => viewportSupportsCine(displaySetService, viewportState))
    .map(([viewportId]) => viewportId);
}

export function getOrderedCineViewportIds(
  servicesManager: AppTypes.ServicesManager,
  controlViewportId: string
): string[] {
  const syncedIds = getSyncedCineViewportIds(servicesManager, controlViewportId);
  const allIds = [controlViewportId, ...syncedIds.filter(id => id !== controlViewportId)];
  const { viewports } = servicesManager.services.viewportGridService.getState();

  return allIds.sort((a, b) => {
    const va = viewports.get(a);
    const vb = viewports.get(b);

    if (!va || !vb) {
      return 0;
    }

    const rowDiff = (va.y ?? 0) - (vb.y ?? 0);

    if (rowDiff !== 0) {
      return rowDiff;
    }

    return (va.x ?? 0) - (vb.x ?? 0);
  });
}

/**
 * True when multiple viewports show different US series (e.g. US | 1×4 hanging protocol).
 */
export function isUsMultiSeriesInstanceLayout(servicesManager: AppTypes.ServicesManager): boolean {
  const { viewportGridService, displaySetService } = servicesManager.services;
  const { viewports, layout } = viewportGridService.getState();
  const gridSize = (layout?.numRows ?? 1) * (layout?.numCols ?? 1);

  if (gridSize <= 1) {
    return false;
  }

  const usDisplaySets = Array.from(viewports.values())
    .map(viewportState => getUsDisplaySetFromViewport(displaySetService, viewportState))
    .filter(Boolean);

  if (usDisplaySets.length < 2) {
    return false;
  }

  const uniqueDisplaySetUIDs = new Set(usDisplaySets.map(ds => ds.displaySetInstanceUID));

  return uniqueDisplaySetUIDs.size > 1;
}

/**
 * Per-viewport cine bar for US multiframe series (any grid layout).
 */
export function shouldUsePerViewportUsCine(servicesManager: AppTypes.ServicesManager): boolean {
  const { viewportGridService, displaySetService } = servicesManager.services;
  const capableViewportIds = getCineCapableViewportIds(servicesManager);

  if (!capableViewportIds.length) {
    return false;
  }

  const { viewports } = viewportGridService.getState();

  return capableViewportIds.some(viewportId => {
    const ds = getUsDisplaySetFromViewport(displaySetService, viewports.get(viewportId));
    return !!ds;
  });
}

/**
 * Show the study-level page header (1/5, play all, stop all) when paging US series.
 */
export function shouldShowUsStudyCineHeader(servicesManager: AppTypes.ServicesManager): boolean {
  const { displaySetService } = servicesManager.services;
  const studyDisplaySets = displaySetService.activeDisplaySets.filter(
    ds => ds?.Modality === 'US' && (ds?.numImageFrames ?? 0) > 0
  );

  return studyDisplaySets.length > 1 && shouldUsePerViewportUsCine(servicesManager);
}

/**
 * When multiple viewports share synced cine, only one viewport shows the cine UI.
 */
export function getCineControlViewportId(servicesManager: AppTypes.ServicesManager): string | null {
  const capableViewportIds = getCineCapableViewportIds(servicesManager);

  if (!capableViewportIds.length) {
    return null;
  }

  if (shouldUsePerViewportUsCine(servicesManager)) {
    const { activeViewportId } = servicesManager.services.viewportGridService.getState();

    if (activeViewportId && capableViewportIds.includes(activeViewportId)) {
      return activeViewportId;
    }

    return capableViewportIds[0];
  }

  if (capableViewportIds.length === 1) {
    return capableViewportIds[0];
  }

  const { activeViewportId } = servicesManager.services.viewportGridService.getState();

  if (activeViewportId && capableViewportIds.includes(activeViewportId)) {
    return activeViewportId;
  }

  return capableViewportIds[0];
}

export function shouldUseUnifiedCineControl(servicesManager: AppTypes.ServicesManager): boolean {
  if (shouldUsePerViewportUsCine(servicesManager)) {
    return false;
  }

  return getCineCapableViewportIds(servicesManager).length > 1;
}

function _getSharedSyncGroupIds(viewportState) {
  const syncGroups = viewportState?.viewportOptions?.syncGroups;

  if (!syncGroups) {
    return [];
  }

  const groups = Array.isArray(syncGroups) ? syncGroups : [syncGroups];

  return groups
    .filter(group => {
      const type = (typeof group === 'string' ? group : group?.type)?.toLowerCase();

      return CINE_SYNC_GROUP_TYPES.has(type);
    })
    .map(group => (typeof group === 'string' ? group : group?.id || group?.type));
}

/**
 * Return viewport ids that should share play/pause and frame-rate when cine changes.
 */
export function getSyncedCineViewportIds(
  servicesManager: AppTypes.ServicesManager,
  srcViewportId: string
): string[] {
  if (isUsMultiSeriesInstanceLayout(servicesManager)) {
    return [];
  }

  const { viewportGridService, cornerstoneViewportService, displaySetService } =
    servicesManager.services;

  const { viewports: viewportsStates } = viewportGridService.getState();
  const srcViewportState = viewportsStates.get(srcViewportId);

  if (!srcViewportState) {
    return [];
  }

  const syncedViewportIds = new Set<string>();
  const allViewportStates = Array.from(viewportsStates.values());
  const srcDisplaySetUIDs = srcViewportState.displaySetInstanceUIDs || [];
  const srcSyncGroupIds = _getSharedSyncGroupIds(srcViewportState);

  // Dynamic volumes sharing the same volume id (existing behaviour).
  if (srcViewportState.viewportOptions?.viewportType === 'volume') {
    const srcViewport = cornerstoneViewportService.getCornerstoneViewport(srcViewportId);
    const srcVolume = srcViewport ? _getVolumeFromViewport(srcViewport) : null;

    if (srcVolume?.isDynamicVolume()) {
      const { volumeId: srcVolumeId } = srcVolume;

      allViewportStates.forEach(({ viewportId }) => {
        if (viewportId === srcViewportId) {
          return;
        }

        const viewport = cornerstoneViewportService.getCornerstoneViewport(viewportId);

        if (viewport?.hasVolumeId?.(srcVolumeId)) {
          syncedViewportIds.add(viewportId);
        }
      });
    }
  }

  // Same display set (e.g. frame view hanging protocol).
  allViewportStates.forEach(viewportState => {
    const { viewportId, displaySetInstanceUIDs = [] } = viewportState;

    if (viewportId === srcViewportId) {
      return;
    }

    const sharesDisplaySet = srcDisplaySetUIDs.some(uid => displaySetInstanceUIDs.includes(uid));

    if (sharesDisplaySet && _viewportSupportsCine(displaySetService, viewportState)) {
      syncedViewportIds.add(viewportId);
    }
  });

  // Shared frame-view / image-slice sync groups.
  if (srcSyncGroupIds.length) {
    allViewportStates.forEach(viewportState => {
      const { viewportId } = viewportState;

      if (viewportId === srcViewportId) {
        return;
      }

      const sharedGroup = _getSharedSyncGroupIds(viewportState).some(id =>
        srcSyncGroupIds.includes(id)
      );

      if (sharedGroup && _viewportSupportsCine(displaySetService, viewportState)) {
        syncedViewportIds.add(viewportId);
      }
    });
  }

  // Multi-viewport layouts (e.g. ALL | 1×2): sync cine across all cine-capable viewports.
  if (allViewportStates.length > 1 && _viewportSupportsCine(displaySetService, srcViewportState)) {
    allViewportStates.forEach(viewportState => {
      const { viewportId } = viewportState;

      if (viewportId !== srcViewportId && _viewportSupportsCine(displaySetService, viewportState)) {
        syncedViewportIds.add(viewportId);
      }
    });
  }

  return Array.from(syncedViewportIds);
}

export function getSyncedViewports(
  servicesManager: AppTypes.ServicesManager,
  srcViewportId: string
) {
  return getSyncedCineViewportIds(servicesManager, srcViewportId).map(viewportId => ({
    viewportId,
  }));
}

export function getViewportEnabledElement(
  cornerstoneViewportService,
  viewportId: string
): HTMLElement | null {
  const viewport = cornerstoneViewportService.getCornerstoneViewport(viewportId);

  return viewport?.element ?? null;
}

export function getElementsForCinePlayback(
  servicesManager: AppTypes.ServicesManager,
  element: HTMLElement,
  viewportId?: string
): HTMLElement[] {
  const { cornerstoneViewportService } = servicesManager.services;
  const elements = new Set<HTMLElement>([element]);

  if (!viewportId) {
    return Array.from(elements);
  }

  getSyncedCineViewportIds(servicesManager, viewportId).forEach(syncedViewportId => {
    const syncedElement = getViewportEnabledElement(cornerstoneViewportService, syncedViewportId);

    if (syncedElement) {
      elements.add(syncedElement);
    }
  });

  return Array.from(elements);
}
