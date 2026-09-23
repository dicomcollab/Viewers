import {
  SOPClassHandlerId,
  SOPClassHandlerId3D,
} from '@ohif/extension-cornerstone-dicom-sr/src/id.js';

const SR_HANDLER_IDS = [SOPClassHandlerId, SOPClassHandlerId3D];

/** DICOM SR document storage SOP classes (subset used for dose / CAD reports). */
export const STRUCTURED_REPORT_SOP_CLASS_UIDS = [
  '1.2.840.10008.5.1.4.1.1.88.11',
  '1.2.840.10008.5.1.4.1.1.88.22',
  '1.2.840.10008.5.1.4.1.1.88.33',
  '1.2.840.10008.5.1.4.1.1.88.34',
  '1.2.840.10008.5.1.4.1.1.88.40',
  '1.2.840.10008.5.1.4.1.1.88.50',
  '1.2.840.10008.5.1.4.1.1.88.59',
  '1.2.840.10008.5.1.4.1.1.88.65',
  '1.2.840.10008.5.1.4.1.1.88.67',
  '1.2.840.10008.5.1.4.1.1.88.68',
  '1.2.840.10008.5.1.4.1.1.88.69',
  '1.2.840.10008.5.1.4.1.1.88.70',
];

export function isStructuredReportSopClassUID(sopClassUID) {
  return (
    typeof sopClassUID === 'string' &&
    STRUCTURED_REPORT_SOP_CLASS_UIDS.includes(sopClassUID)
  );
}

export function isStructuredReportDisplaySet(displaySet) {
  if (!displaySet) {
    return false;
  }
  return (
    displaySet.Modality === 'SR' ||
    isStructuredReportSopClassUID(displaySet.SOPClassUID) ||
    (displaySet.SOPClassHandlerId && SR_HANDLER_IDS.includes(displaySet.SOPClassHandlerId))
  );
}

/**
 * Pick a viewport that can show SR (prefer one already showing SR).
 */
export function resolveViewportIdForStructuredReport(
  displaySet,
  { activeViewportId, viewportGridService, displaySetService }
) {
  if (!isStructuredReportDisplaySet(displaySet)) {
    return activeViewportId;
  }

  const { viewports } = viewportGridService.getState();

  for (const vp of viewports.values()) {
    const uids = vp.displaySetInstanceUIDs || [];
    for (const uid of uids) {
      const ds = displaySetService.getDisplaySetByUID(uid);
      if (ds && SR_HANDLER_IDS.includes(ds.SOPClassHandlerId)) {
        return vp.viewportOptions.viewportId;
      }
    }
  }

  for (const vp of viewports.values()) {
    if (vp.displaySetInstanceUIDs?.includes(displaySet.displaySetInstanceUID)) {
      return vp.viewportOptions.viewportId;
    }
  }

  return activeViewportId;
}

/**
 * HP-driven viewport updates with a direct fallback so SR always opens.
 */
export function buildViewportsUpdateForDisplaySet(
  displaySetInstanceUID,
  viewportId,
  hangingProtocolService,
  isHangingProtocolLayout
) {
  try {
    const updated = hangingProtocolService.getViewportsRequireUpdate(
      viewportId,
      displaySetInstanceUID,
      isHangingProtocolLayout
    );
    if (updated?.length) {
      return updated;
    }
  } catch (error) {
    console.warn('[SR] getViewportsRequireUpdate failed, using direct assignment', error);
  }

  return [
    {
      viewportId,
      displaySetInstanceUIDs: [displaySetInstanceUID],
    },
  ];
}

const ONE_UP_POLL_INTERVAL_MS = 50;
const ONE_UP_MAX_POLLS = 20;
const PROTOCOL_CHANGE_FALLBACK_MS = 500;

/** Layout in effect before SR forced 1×1 — restored when opening images again. */
let srOneUpLayoutSnapshot = null;
/** True while restoring that layout so persistence does not force 1×1 mid-restore. */
let srLayoutRestoreInFlight = false;

function isOneUpGridState({ layout, viewports }) {
  return layout?.numRows === 1 && layout?.numCols === 1 && viewports?.size === 1;
}

function isMultiViewportLayout(snapshot) {
  if (!snapshot) {
    return false;
  }
  const tiles = (snapshot.numRows || 1) * (snapshot.numCols || 1);
  if (tiles > 1) {
    return true;
  }
  return Boolean(
    snapshot.protocolId &&
      snapshot.protocolId !== 'allModality1x1' &&
      snapshot.protocolId !== 'usModality1x1'
  );
}

function captureSrOneUpLayoutSnapshot(servicesManager) {
  // Keep the first pre-SR layout when opening another SR from 1×1.
  if (srOneUpLayoutSnapshot) {
    return;
  }

  const { hangingProtocolService, viewportGridService } = servicesManager.services;
  const hpState = hangingProtocolService?.getState?.() || {};
  const layout = viewportGridService?.getState?.()?.layout || {};

  srOneUpLayoutSnapshot = {
    protocolId: hpState.protocolId,
    stageId: hpState.stageId,
    stageIndex: hpState.stageIndex,
    numRows: layout.numRows,
    numCols: layout.numCols,
  };
}

function consumeSrOneUpLayoutSnapshot() {
  const snapshot = srOneUpLayoutSnapshot;
  srOneUpLayoutSnapshot = null;
  return snapshot;
}

export function hasSrOneUpLayoutToRestore() {
  return isMultiViewportLayout(srOneUpLayoutSnapshot) || srLayoutRestoreInFlight;
}

/**
 * Assign to a viewport that exists in the *current* grid. A viewport id read before a hanging
 * protocol change is stale — the layout rebuilds the viewport map with new ids, and dispatching
 * an unknown id leaves the grid without a matching viewport.
 */
function assignDisplaySetToActiveViewport(displaySetInstanceUID, viewportGridService) {
  const { viewports, activeViewportId } = viewportGridService.getState();

  if (!displaySetInstanceUID || !viewports?.size) {
    return;
  }

  const alreadyDisplayed = [...viewports.values()].some(viewport =>
    viewport?.displaySetInstanceUIDs?.includes(displaySetInstanceUID)
  );

  if (alreadyDisplayed) {
    return;
  }

  const viewportId = viewports.has(activeViewportId)
    ? activeViewportId
    : viewports.keys().next().value;

  if (!viewportId) {
    return;
  }

  viewportGridService.setDisplaySetsForViewports([
    {
      viewportId,
      displaySetInstanceUIDs: [displaySetInstanceUID],
    },
  ]);
}

function assignStructuredReportToActiveViewport(displaySet, viewportGridService) {
  assignDisplaySetToActiveViewport(displaySet?.displaySetInstanceUID, viewportGridService);
}

/**
 * The grid applies a protocol change through a React reducer, so the state read synchronously
 * from PROTOCOL_CHANGED still describes the previous layout. Poll until the 1×1 grid is in place.
 */
function assignWhenOneUpApplied(displaySet, viewportGridService, attempt = 0) {
  if (isOneUpGridState(viewportGridService.getState()) || attempt >= ONE_UP_MAX_POLLS) {
    assignStructuredReportToActiveViewport(displaySet, viewportGridService);
    return;
  }

  window.setTimeout(
    () => assignWhenOneUpApplied(displaySet, viewportGridService, attempt + 1),
    ONE_UP_POLL_INTERVAL_MS
  );
}

function isGridMatchingSnapshot(gridState, snapshot) {
  const layout = gridState?.layout;
  if (!layout || !snapshot) {
    return false;
  }
  if (snapshot.numRows && snapshot.numCols) {
    return layout.numRows === snapshot.numRows && layout.numCols === snapshot.numCols;
  }
  return !isOneUpGridState(gridState);
}

/**
 * Poll until the restored multi-viewport grid is applied, then place the display set.
 */
function assignWhenLayoutRestored(
  displaySetInstanceUID,
  viewportGridService,
  snapshot,
  attempt = 0
) {
  if (isGridMatchingSnapshot(viewportGridService.getState(), snapshot) || attempt >= ONE_UP_MAX_POLLS) {
    assignDisplaySetToActiveViewport(displaySetInstanceUID, viewportGridService);
    srLayoutRestoreInFlight = false;
    return;
  }

  window.setTimeout(
    () =>
      assignWhenLayoutRestored(displaySetInstanceUID, viewportGridService, snapshot, attempt + 1),
    ONE_UP_POLL_INTERVAL_MS
  );
}

/**
 * SR documents need a full-screen 1×1 viewport. Switch hanging protocol, then
 * put this SR in the single tile (HP may otherwise hang the first image series).
 */
export function presentStructuredReportInOneUp({ displaySet, commandsManager, servicesManager }) {
  const { hangingProtocolService, viewportGridService } = servicesManager.services;

  if (isOneUpGridState(viewportGridService.getState())) {
    assignStructuredReportToActiveViewport(displaySet, viewportGridService);
    return;
  }

  captureSrOneUpLayoutSnapshot(servicesManager);

  let started = false;
  const startAssigning = () => {
    if (started) {
      return;
    }
    started = true;
    assignWhenOneUpApplied(displaySet, viewportGridService);
  };

  const subscription = hangingProtocolService.subscribe(
    hangingProtocolService.EVENTS.PROTOCOL_CHANGED,
    () => {
      if (typeof subscription?.unsubscribe === 'function') {
        subscription.unsubscribe();
      }
      startAssigning();
    }
  );

  commandsManager.run({
    commandName: 'setHangingProtocol',
    commandOptions: {
      protocolId: 'allModality1x1',
      stageId: '1x1',
      reset: true,
    },
  });

  window.setTimeout(() => {
    if (typeof subscription?.unsubscribe === 'function') {
      subscription.unsubscribe();
    }
    startAssigning();
  }, PROTOCOL_CHANGE_FALLBACK_MS);
}

/**
 * After SR forced 1×1, restore the prior multi-viewport layout (e.g. 2×2) and
 * place the newly opened image series. Returns true when restore was started.
 */
export function presentDisplaySetAfterStructuredReport({
  displaySetInstanceUID,
  commandsManager,
  servicesManager,
}) {
  if (!isMultiViewportLayout(srOneUpLayoutSnapshot)) {
    return false;
  }

  const snapshot = consumeSrOneUpLayoutSnapshot();
  srLayoutRestoreInFlight = true;

  const { hangingProtocolService, viewportGridService } = servicesManager.services;

  const protocolId = snapshot.protocolId || 'allModality2x2';
  const stageId =
    snapshot.stageId ||
    (protocolId === 'allModality2x2'
      ? '2x2'
      : protocolId === 'allModality1x2'
        ? '1x2'
        : protocolId === 'allModality2x4'
          ? '2x4'
          : undefined);

  let started = false;
  const startAssigning = () => {
    if (started) {
      return;
    }
    started = true;
    assignWhenLayoutRestored(displaySetInstanceUID, viewportGridService, snapshot);
  };

  const subscription = hangingProtocolService.subscribe(
    hangingProtocolService.EVENTS.PROTOCOL_CHANGED,
    () => {
      if (typeof subscription?.unsubscribe === 'function') {
        subscription.unsubscribe();
      }
      startAssigning();
    }
  );

  commandsManager.run({
    commandName: 'setHangingProtocol',
    commandOptions: {
      protocolId,
      ...(stageId ? { stageId } : {}),
      ...(typeof snapshot.stageIndex === 'number' ? { stageIndex: snapshot.stageIndex } : {}),
      reset: true,
    },
  });

  window.setTimeout(() => {
    if (typeof subscription?.unsubscribe === 'function') {
      subscription.unsubscribe();
    }
    startAssigning();
  }, PROTOCOL_CHANGE_FALLBACK_MS);

  return true;
}
