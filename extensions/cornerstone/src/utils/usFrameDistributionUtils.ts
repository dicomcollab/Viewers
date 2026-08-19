import {
  canUseUsFrameDistribution,
  captureFrameDistributionLayoutSnapshot,
  consumeFrameDistributionLayoutSnapshot,
  getSingleUsMultiframeDisplaySet,
  getSrDisplaySets,
  getUsFrameDistributionBatchStart,
  getUsImageDisplaySets,
  isUsFrameDistributionEnabled,
  setUsFrameDistributionBatchStart,
  setUsFrameDistributionEnabled,
} from '@ohif/extension-default';
import { pauseAllUsViewports } from './usCinePlaybackUtils';
import { getUsLayoutGridSize, getUsLayoutViewportIds } from './usGridViewportUtils';
import {
  getAliveViewport,
  getViewportFrameCount,
  getViewportFrameIndex,
  setViewportFrameIndexById,
} from './safeViewportFrameUtils';

type DistributionSlot =
  | { kind: 'frame'; displaySetInstanceUID: string; frameIndex: number }
  | { kind: 'sr'; displaySetInstanceUID: string }
  | { kind: 'empty' };

let applyInFlight = false;
let offsetRetryHandle: number | null = null;

function getLastBatchStart(totalCount: number, batchSize: number): number {
  if (totalCount <= batchSize) {
    return 0;
  }

  return Math.floor((totalCount - 1) / batchSize) * batchSize;
}

function cancelOffsetRetry(): void {
  if (offsetRetryHandle != null) {
    window.clearTimeout(offsetRetryHandle);
    offsetRetryHandle = null;
  }
}

function getDistributionMeta(servicesManager: AppTypes.ServicesManager) {
  const { displaySetService } = servicesManager.services;
  const displaySet = getSingleUsMultiframeDisplaySet(displaySetService);

  if (!displaySet) {
    return null;
  }

  const numFrames = Number(displaySet.numImageFrames) || 0;

  if (numFrames <= 1) {
    return null;
  }

  const srDisplaySets = getSrDisplaySets(displaySetService, displaySet.StudyInstanceUID);
  const totalCount = numFrames + srDisplaySets.length;

  return {
    displaySet,
    numFrames,
    srDisplaySets,
    totalCount,
  };
}

function getDistributionSlot(
  meta: NonNullable<ReturnType<typeof getDistributionMeta>>,
  itemIndex: number
): DistributionSlot {
  if (itemIndex < 0 || itemIndex >= meta.totalCount) {
    return { kind: 'empty' };
  }

  if (itemIndex < meta.numFrames) {
    return {
      kind: 'frame',
      displaySetInstanceUID: meta.displaySet.displaySetInstanceUID,
      frameIndex: itemIndex,
    };
  }

  const sr = meta.srDisplaySets[itemIndex - meta.numFrames];

  return sr
    ? { kind: 'sr', displaySetInstanceUID: sr.displaySetInstanceUID }
    : { kind: 'empty' };
}

function getDistributionSlots(
  servicesManager: AppTypes.ServicesManager,
  batchStart?: number
): { meta: NonNullable<ReturnType<typeof getDistributionMeta>>; slots: DistributionSlot[] } | null {
  const meta = getDistributionMeta(servicesManager);

  if (!meta) {
    return null;
  }

  const viewportIds = getUsLayoutViewportIds(servicesManager);
  const batchSize = Math.max(1, viewportIds.length);
  const start = Math.min(
    batchStart ?? getUsFrameDistributionBatchStart(),
    getLastBatchStart(meta.totalCount, batchSize)
  );

  return {
    meta,
    slots: viewportIds.map((_, index) => getDistributionSlot(meta, start + index)),
  };
}

function slotsMatchViewports(
  servicesManager: AppTypes.ServicesManager,
  slots: DistributionSlot[]
): boolean {
  const { viewportGridService } = servicesManager.services;
  const { viewports } = viewportGridService.getState();
  const viewportIds = getUsLayoutViewportIds(servicesManager);

  if (viewportIds.length !== slots.length) {
    return false;
  }

  return viewportIds.every((viewportId, index) => {
    const uids = viewports.get(viewportId)?.displaySetInstanceUIDs ?? [];
    const slot = slots[index];

    if (slot.kind === 'empty') {
      return uids.length === 0;
    }

    return uids.length === 1 && uids[0] === slot.displaySetInstanceUID;
  });
}

function frameOffsetsMatchViewports(
  servicesManager: AppTypes.ServicesManager,
  slots: DistributionSlot[]
): boolean {
  const { cornerstoneViewportService } = servicesManager.services;
  const viewportIds = getUsLayoutViewportIds(servicesManager);

  if (viewportIds.length !== slots.length) {
    return false;
  }

  return viewportIds.every((viewportId, index) => {
    const slot = slots[index];

    if (slot.kind !== 'frame') {
      return true;
    }

    const viewport = getAliveViewport(cornerstoneViewportService, viewportId);

    if (!viewport) {
      return false;
    }

    return getViewportFrameIndex(viewport) === slot.frameIndex;
  });
}

function applyFrameOffsetsWhenReady(
  servicesManager: AppTypes.ServicesManager,
  viewportIds: string[],
  slots: DistributionSlot[],
  attempt = 0
): void {
  const { cornerstoneViewportService } = servicesManager.services;
  const frameViewportIds = viewportIds.filter((_, index) => slots[index]?.kind === 'frame');
  const ready =
    frameViewportIds.length === 0 ||
    frameViewportIds.every(viewportId => {
      const viewport = getAliveViewport(cornerstoneViewportService, viewportId);

      return getViewportFrameCount(viewport) > 1;
    });

  if (!ready && attempt < 25) {
    offsetRetryHandle = window.setTimeout(() => {
      applyFrameOffsetsWhenReady(servicesManager, viewportIds, slots, attempt + 1);
    }, 120);
    return;
  }

  viewportIds.forEach((viewportId, index) => {
    const slot = slots[index];

    if (slot?.kind !== 'frame') {
      return;
    }

    setViewportFrameIndexById(cornerstoneViewportService, viewportId, slot.frameIndex);
  });

  applyInFlight = false;
}

/**
 * Load frames of the single US cine into the layout, then place SR reports
 * on later pages so they occupy the last viewports (e.g. 20 frames + 2 SRs
 * in 2×2 is 6 pages, last page shows the two reports).
 *
 * Does not attach a frameview synchronizer, so wheel/scrub stays independent.
 * Cine is paused — the user starts playback if they want it.
 */
function applyUsFrameDistribution(
  servicesManager: AppTypes.ServicesManager,
  options: { force?: boolean } = {}
): boolean {
  if (!isUsFrameDistributionEnabled()) {
    return false;
  }

  if (applyInFlight && !options.force) {
    return false;
  }

  cancelOffsetRetry();
  applyInFlight = false;

  const viewportIds = getUsLayoutViewportIds(servicesManager);

  const planned = getDistributionSlots(servicesManager);

  if (!planned) {
    return false;
  }

  const { meta, slots } = planned;
  const batchSize = viewportIds.length;
  const batchStart = Math.min(
    getUsFrameDistributionBatchStart(),
    getLastBatchStart(meta.totalCount, batchSize)
  );

  setUsFrameDistributionBatchStart(batchStart);

  const { viewportGridService } = servicesManager.services;
  const slotsAlreadyMatch = slotsMatchViewports(servicesManager, slots);

  if (!slotsAlreadyMatch) {
    pauseAllUsViewports(servicesManager);
    applyInFlight = true;
    cancelOffsetRetry();

    viewportGridService.setDisplaySetsForViewports(
      viewportIds.map((viewportId, index) => {
        const slot = slots[index];

        if (slot.kind === 'empty') {
          return {
            viewportId,
            displaySetInstanceUIDs: [],
            viewportOptions: {
              viewportType: 'stack',
              toolGroupId: 'default',
            },
          };
        }

        if (slot.kind === 'sr') {
          return {
            viewportId,
            displaySetInstanceUIDs: [slot.displaySetInstanceUID],
            viewportOptions: {
              toolGroupId: 'default',
            },
          };
        }

        return {
          viewportId,
          displaySetInstanceUIDs: [slot.displaySetInstanceUID],
          viewportOptions: {
            viewportType: 'stack',
            toolGroupId: 'default',
            initialImageOptions: {
              index: slot.frameIndex,
              useOnce: true,
            },
          },
        };
      })
    );
  }

  cancelOffsetRetry();
  applyFrameOffsetsWhenReady(servicesManager, viewportIds, slots);

  return true;
}

function needsUsFrameDistributionApply(servicesManager: AppTypes.ServicesManager): boolean {
  if (!isUsFrameDistributionEnabled()) {
    return false;
  }

  const { displaySetService } = servicesManager.services;

  if (!canUseUsFrameDistribution(displaySetService)) {
    return false;
  }

  const planned = getDistributionSlots(servicesManager);

  if (!planned) {
    return true;
  }

  return (
    !slotsMatchViewports(servicesManager, planned.slots) ||
    !frameOffsetsMatchViewports(servicesManager, planned.slots)
  );
}

function restoreHangingProtocol(
  commandsManager: AppTypes.CommandsManager,
  servicesManager: AppTypes.ServicesManager
): void {
  const snapshot = consumeFrameDistributionLayoutSnapshot();
  const hpState = servicesManager.services.hangingProtocolService.getState();
  const singleUs = getUsImageDisplaySets(servicesManager.services.displaySetService).length === 1;
  const snapshotIs1x1 =
    snapshot?.protocolId === 'allModality1x1' ||
    snapshot?.stageId === '1x1' ||
    snapshot?.protocolId === 'usModality1x1';

  // A single US instance always hangs 1×1. Do not keep a 2×2 that Frame Dist
  // or unmatched HP fill applied on top of that study.
  const use1x1 = singleUs && (snapshotIs1x1 || !snapshot?.protocolId);

  commandsManager.run({
    commandName: 'setHangingProtocol',
    commandOptions: use1x1
      ? {
          protocolId: 'allModality1x1',
          stageId: '1x1',
          stageIndex: 0,
          reset: true,
        }
      : {
          protocolId: snapshot?.protocolId ?? hpState?.protocolId,
          stageId: snapshot?.stageId ?? hpState?.stageId,
          stageIndex: snapshot?.stageIndex ?? hpState?.stageIndex,
          reset: true,
        },
  });

  window.setTimeout(() => clearDuplicateSingleUsViewports(servicesManager), 80);
  window.setTimeout(() => clearDuplicateSingleUsViewports(servicesManager), 300);
}

/**
 * 2×2 (and larger) hanging protocols use allowUnmatchedView, so leftover Frame
 * Dist tiles keep showing the same US instance. Keep it only in the first tile.
 */
function clearDuplicateSingleUsViewports(servicesManager: AppTypes.ServicesManager): void {
  const { displaySetService, viewportGridService } = servicesManager.services;
  const usSets = getUsImageDisplaySets(displaySetService);

  if (usSets.length !== 1) {
    return;
  }

  const usUid = usSets[0].displaySetInstanceUID;
  const viewportIds = getUsLayoutViewportIds(servicesManager);
  const { viewports } = viewportGridService.getState();
  let keptFirst = false;
  const updates = [];

  viewportIds.forEach(viewportId => {
    const uids = viewports.get(viewportId)?.displaySetInstanceUIDs ?? [];

    if (!uids.includes(usUid)) {
      return;
    }

    if (!keptFirst) {
      keptFirst = true;
      return;
    }

    updates.push({
      viewportId,
      displaySetInstanceUIDs: [],
      viewportOptions: {
        viewportType: 'stack',
        toolGroupId: 'default',
      },
    });
  });

  if (updates.length) {
    viewportGridService.setDisplaySetsForViewports(updates);
  }
}

function setUsFrameDistribution(
  servicesManager: AppTypes.ServicesManager,
  commandsManager: AppTypes.CommandsManager,
  enabled: boolean
): void {
  const { displaySetService, hangingProtocolService } = servicesManager.services;

  if (enabled && !canUseUsFrameDistribution(displaySetService)) {
    setUsFrameDistributionEnabled(false);
    return;
  }

  if (enabled && !isUsFrameDistributionEnabled()) {
    const hpState = hangingProtocolService.getState();
    captureFrameDistributionLayoutSnapshot({
      protocolId: hpState?.protocolId,
      stageId: hpState?.stageId,
      stageIndex: hpState?.stageIndex,
    });
  }

  setUsFrameDistributionEnabled(enabled);

  if (!enabled) {
    cancelOffsetRetry();
    applyInFlight = false;
    restoreHangingProtocol(commandsManager, servicesManager);
    return;
  }

  setUsFrameDistributionBatchStart(0);
  pauseAllUsViewports(servicesManager);

  applyUsFrameDistribution(servicesManager);
}

function snapBatchStartToLayout(
  servicesManager: AppTypes.ServicesManager,
  batchSize: number
): void {
  const meta = getDistributionMeta(servicesManager);

  if (!meta || batchSize <= 0) {
    return;
  }

  const batchStart = getUsFrameDistributionBatchStart();
  const alignedStart = Math.floor(batchStart / batchSize) * batchSize;

  setUsFrameDistributionBatchStart(
    Math.min(alignedStart, getLastBatchStart(meta.totalCount, batchSize))
  );
}

function initUsFrameDistribution(servicesManager: AppTypes.ServicesManager): void {
  const { displaySetService, hangingProtocolService, viewportGridService } =
    servicesManager.services;

  let reapplyHandle: number | null = null;
  let lastGridSize = getUsLayoutGridSize(servicesManager);

  const scheduleReapply = () => {
    if (reapplyHandle != null) {
      window.clearTimeout(reapplyHandle);
    }

    reapplyHandle = window.setTimeout(() => {
      reapplyHandle = null;

      if (!isUsFrameDistributionEnabled()) {
        return;
      }

      if (!canUseUsFrameDistribution(displaySetService)) {
        setUsFrameDistributionEnabled(false);
        return;
      }

      const gridSize = getUsLayoutGridSize(servicesManager);
      const gridSizeChanged = gridSize !== lastGridSize;

      lastGridSize = gridSize;

      if (gridSizeChanged) {
        snapBatchStartToLayout(servicesManager, gridSize);
        applyUsFrameDistribution(servicesManager, { force: true });
        return;
      }

      if (needsUsFrameDistributionApply(servicesManager)) {
        applyUsFrameDistribution(servicesManager);
      }
    }, 60);
  };

  viewportGridService.subscribe(viewportGridService.EVENTS.GRID_STATE_CHANGED, scheduleReapply);
  hangingProtocolService.subscribe(hangingProtocolService.EVENTS.PROTOCOL_CHANGED, scheduleReapply);
  displaySetService.subscribe(displaySetService.EVENTS.DISPLAY_SETS_CHANGED, scheduleReapply);
}

function getUsFrameDistributionPageInfo(servicesManager: AppTypes.ServicesManager) {
  const meta = getDistributionMeta(servicesManager);

  if (!meta) {
    return null;
  }

  const batchSize = getUsLayoutGridSize(servicesManager);
  let batchStart = Math.min(
    getUsFrameDistributionBatchStart(),
    getLastBatchStart(meta.totalCount, batchSize)
  );

  if (batchSize === 1) {
    const { cornerstoneViewportService } = servicesManager.services;
    const viewportId = getUsLayoutViewportIds(servicesManager)[0];
    const viewport = viewportId
      ? getAliveViewport(cornerstoneViewportService, viewportId)
      : null;
    const currentIndex = viewport ? getViewportFrameIndex(viewport) : -1;

    if (currentIndex >= 0 && viewport) {
      batchStart = Math.min(currentIndex, meta.totalCount - 1);
      setUsFrameDistributionBatchStart(batchStart);
    }
  }

  const totalPages = Math.max(1, Math.ceil(meta.totalCount / batchSize));
  const currentPage = Math.min(totalPages, Math.floor(batchStart / batchSize) + 1);

  return {
    batchSize,
    batchStart,
    batchEnd: Math.min(batchStart + batchSize, meta.totalCount),
    totalCount: meta.totalCount,
    currentPage,
    totalPages,
    hasNextBatch: batchStart + batchSize < meta.totalCount,
    hasPrevBatch: batchStart > 0,
    mode: 'frames' as const,
  };
}

export {
  applyUsFrameDistribution,
  getUsFrameDistributionPageInfo,
  initUsFrameDistribution,
  needsUsFrameDistributionApply,
  setUsFrameDistribution,
};
