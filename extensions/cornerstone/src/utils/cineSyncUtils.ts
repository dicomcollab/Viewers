import { cache, Types } from '@cornerstonejs/core';

const CINE_SYNC_GROUP_TYPES = new Set(['frameview', 'imageslice', 'stackimage', 'image_slice']);

function _getVolumeFromViewport(viewport: Types.IBaseVolumeViewport) {
  const volumeIds = viewport.getAllVolumeIds();
  const volumes = volumeIds.map(id => cache.getVolume(id));
  const dynamicVolume = volumes.find(volume => volume.isDynamicVolume());

  return dynamicVolume ?? volumes[0];
}

export function isInIframeEmbed(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

/**
 * Stack-based cine (play/pause, FPS, frame step) for any modality with multiple frames.
 * Callers that autoplay or show US-specific UI must also check isUsMultiframeDisplaySet.
 */
export function isMultiframeStackDisplaySet(displaySet) {
  if (!displaySet || displaySet.unsupported || displaySet.isDynamicVolume) {
    return false;
  }

  return (displaySet.numImageFrames ?? 0) > 1;
}

/** Ultrasound multiframe (or multi-instance) stack eligible for US cine autoplay/UI. */
export function isUsMultiframeDisplaySet(displaySet) {
  return displaySet?.Modality === 'US' && isMultiframeStackDisplaySet(displaySet);
}

export function isCineCapableDisplaySet(displaySet) {
  if (!displaySet || displaySet.unsupported) {
    return false;
  }

  return displaySet.isDynamicVolume || (displaySet.numImageFrames ?? 0) > 1;
}

export function getCineDisplaySetFromViewport(displaySetService, viewportState) {
  const displaySetInstanceUIDs = viewportState?.displaySetInstanceUIDs ?? [];

  return displaySetInstanceUIDs
    .map(uid => displaySetService.getDisplaySetByUID(uid))
    .find(isCineCapableDisplaySet);
}

function getUsDisplaySetFromViewport(displaySetService, viewportState) {
  return getCineDisplaySetFromViewport(displaySetService, viewportState);
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
 * True when multiple viewports show different cine-capable series (e.g. 1×4 hanging protocol).
 */
export function isMultiSeriesInstanceLayout(servicesManager: AppTypes.ServicesManager): boolean {
  const { viewportGridService, displaySetService } = servicesManager.services;
  const { viewports, layout } = viewportGridService.getState();
  const gridSize = (layout?.numRows ?? 1) * (layout?.numCols ?? 1);

  if (gridSize <= 1) {
    return false;
  }

  const cineDisplaySets = Array.from(viewports.values())
    .map(viewportState => getCineDisplaySetFromViewport(displaySetService, viewportState))
    .filter(Boolean);

  if (cineDisplaySets.length < 2) {
    return false;
  }

  const uniqueDisplaySetUIDs = new Set(cineDisplaySets.map(ds => ds.displaySetInstanceUID));

  return uniqueDisplaySetUIDs.size > 1;
}

/** @deprecated Use isMultiSeriesInstanceLayout */
export function isUsMultiSeriesInstanceLayout(servicesManager: AppTypes.ServicesManager): boolean {
  return isMultiSeriesInstanceLayout(servicesManager);
}

/**
 * Per-viewport slider cine bar for multiframe stacks (US, CT, MR, …).
 * Same bottom-of-viewport UI for all modalities; autoplay stays US-only.
 */
export function shouldUsePerViewportCine(servicesManager: AppTypes.ServicesManager): boolean {
  const { viewportGridService, displaySetService } = servicesManager.services;
  const capableViewportIds = getCineCapableViewportIds(servicesManager);

  if (!capableViewportIds.length) {
    return false;
  }

  const { viewports } = viewportGridService.getState();

  return capableViewportIds.some(viewportId => {
    const ds = getCineDisplaySetFromViewport(displaySetService, viewports.get(viewportId));
    return isMultiframeStackDisplaySet(ds);
  });
}

/** @deprecated Use shouldUsePerViewportCine */
export function shouldUsePerViewportUsCine(servicesManager: AppTypes.ServicesManager): boolean {
  return shouldUsePerViewportCine(servicesManager);
}

/**
 * Show study-level US cine controls in the viewer header (page nav + sync + FPS/fr).
 * Ultrasound only — CT/MR multi-slice must not show US header cine chrome.
 */
export function shouldShowStudyCineHeaderControls(
  servicesManager: AppTypes.ServicesManager
): boolean {
  const { displaySetService } = servicesManager.services;
  const usMultiframeSets = displaySetService.activeDisplaySets.filter(isUsMultiframeDisplaySet);

  return usMultiframeSets.length > 0;
}

export function activeViewportUsesMultiframeCine(
  servicesManager: AppTypes.ServicesManager,
  viewportId?: string
): boolean {
  const { viewportGridService, displaySetService } = servicesManager.services;
  const { activeViewportId, viewports } = viewportGridService.getState();
  const targetViewportId = viewportId || activeViewportId;
  const viewportState = targetViewportId ? viewports.get(targetViewportId) : null;

  if (!viewportState) {
    return false;
  }

  const displaySetInstanceUIDs = viewportState.displaySetInstanceUIDs ?? [];

  return displaySetInstanceUIDs.some(uid => {
    const displaySet = displaySetService.getDisplaySetByUID(uid);
    return isMultiframeStackDisplaySet(displaySet);
  });
}

/** @deprecated Use activeViewportUsesMultiframeCine */
export function activeViewportUsesUsVideoCine(
  servicesManager: AppTypes.ServicesManager,
  viewportId?: string
): boolean {
  return activeViewportUsesMultiframeCine(servicesManager, viewportId);
}

/** @deprecated Use shouldShowStudyCineHeaderControls */
export function shouldShowUsStudyCineHeader(servicesManager: AppTypes.ServicesManager): boolean {
  return shouldShowStudyCineHeaderControls(servicesManager);
}

/**
 * When multiple viewports share synced cine, only one viewport shows the cine UI.
 */
export function getCineControlViewportId(servicesManager: AppTypes.ServicesManager): string | null {
  const capableViewportIds = getCineCapableViewportIds(servicesManager);

  if (!capableViewportIds.length) {
    return null;
  }

  if (shouldUsePerViewportCine(servicesManager)) {
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
  if (shouldUsePerViewportCine(servicesManager)) {
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
 * Viewports rendering the same dynamic (4D) volume — these always share cine state.
 */
function _getDynamicVolumePeerIds(
  servicesManager: AppTypes.ServicesManager,
  srcViewportId: string
): string[] {
  const { viewportGridService, cornerstoneViewportService } = servicesManager.services;
  const { viewports: viewportsStates } = viewportGridService.getState();
  const srcViewportState = viewportsStates.get(srcViewportId);

  if (srcViewportState?.viewportOptions?.viewportType !== 'volume') {
    return [];
  }

  const srcViewport = cornerstoneViewportService.getCornerstoneViewport(srcViewportId);
  const srcVolume = srcViewport ? _getVolumeFromViewport(srcViewport) : null;

  if (!srcVolume?.isDynamicVolume()) {
    return [];
  }

  const { volumeId: srcVolumeId } = srcVolume;

  return Array.from(viewportsStates.values())
    .map(({ viewportId }) => viewportId)
    .filter(viewportId => {
      if (viewportId === srcViewportId) {
        return false;
      }

      return !!cornerstoneViewportService
        .getCornerstoneViewport(viewportId)
        ?.hasVolumeId?.(srcVolumeId);
    });
}

/**
 * Return viewport ids that should share play/pause and frame-rate when cine changes.
 */
export function getSyncedCineViewportIds(
  servicesManager: AppTypes.ServicesManager,
  srcViewportId: string
): string[] {
  if (isMultiSeriesInstanceLayout(servicesManager)) {
    return [];
  }

  const { viewportGridService, displaySetService } = servicesManager.services;

  const { viewports: viewportsStates } = viewportGridService.getState();
  const srcViewportState = viewportsStates.get(srcViewportId);

  if (!srcViewportState) {
    return [];
  }

  const syncedViewportIds = new Set<string>(
    _getDynamicVolumePeerIds(servicesManager, srcViewportId)
  );
  const allViewportStates = Array.from(viewportsStates.values());
  const srcDisplaySetUIDs = srcViewportState.displaySetInstanceUIDs || [];
  const srcSyncGroupIds = _getSharedSyncGroupIds(srcViewportState);

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

/**
 * Viewport ids that must receive cine state changes automatically.
 *
 * Only dynamic (4D) volumes qualify, since those viewports render one series
 * split across the layout. Cine sync between separate series is applied
 * explicitly by the sync modes in usCinePlaybackUtils, which keeps play state
 * predictable — in sync playback just one viewport drives the others.
 */
export function getCineSyncPeerIds(
  servicesManager: AppTypes.ServicesManager,
  srcViewportId: string
): string[] {
  return _getDynamicVolumePeerIds(servicesManager, srcViewportId);
}

export function getSyncedViewports(
  servicesManager: AppTypes.ServicesManager,
  srcViewportId: string
) {
  return getCineSyncPeerIds(servicesManager, srcViewportId).map(viewportId => ({
    viewportId,
  }));
}

export function getViewportEnabledElement(
  cornerstoneViewportService,
  viewportId: string
): HTMLElement | null {
  try {
    const viewport = cornerstoneViewportService.getCornerstoneViewport(viewportId);

    if (!viewport || viewport.isDisabled) {
      return null;
    }

    return viewport.element ?? null;
  } catch {
    return null;
  }
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
