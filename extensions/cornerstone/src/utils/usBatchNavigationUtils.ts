import {
  getCineControlViewportId,
  getCineDisplaySetFromViewport,
  getViewportEnabledElement,
} from './cineSyncUtils';
import {
  getAliveViewport,
  getViewportFrameIndex,
  recoverLayoutStackViewports,
  setViewportFrameIndexById,
} from './safeViewportFrameUtils';
import { playAllUsViewports } from './usCinePlaybackUtils';
import { getUsLayoutGridSize, getUsLayoutViewportIds } from './usGridViewportUtils';
import {
  isUsFrameDistributionEnabled,
  setUsFrameDistributionBatchStart,
  syncViewportGridToStudyPanelOrder,
  getDisplaySetsInStudyPanelOrder,
  getStudyPanelNavigationOrder,
} from '@ohif/extension-default';
import {
  applyUsFrameDistribution,
  getUsFrameDistributionPageInfo,
} from './usFrameDistributionUtils';
import { bumpCineGeneration } from './cineClipStateUtils';
import { shouldSuppressCineAutoplay, suppressCineAutoplay } from './cineAutoplaySuppress';
import { snapshotUsLayoutInstanceFrames } from './usInstanceFrameState';
import { eventTarget, EVENTS } from '@cornerstonejs/core';
import { utils } from '@ohif/core';

let lastPagingInventoryKey = '';

const PENDING_BATCH_TTL_MS = 2000;

// setDisplaySetsForViewports lands asynchronously, so rapid clicks must page from the
// last requested batch rather than the grid state that has not caught up yet.
let pendingInstanceBatch: {
  studyUid: string;
  batchSize: number;
  batchStart: number;
  at: number;
} | null = null;

function getPendingInstanceBatchStart(studyUid: string, batchSize: number): number | null {
  if (
    !pendingInstanceBatch ||
    pendingInstanceBatch.studyUid !== studyUid ||
    pendingInstanceBatch.batchSize !== batchSize ||
    Date.now() - pendingInstanceBatch.at > PENDING_BATCH_TTL_MS
  ) {
    pendingInstanceBatch = null;
    return null;
  }

  return pendingInstanceBatch.batchStart;
}

type UsBatchNavigationInfo = {
  batchSize: number;
  batchStart: number;
  batchEnd: number;
  totalCount: number;
  currentPage: number;
  totalPages: number;
  hasNextBatch: boolean;
  hasPrevBatch: boolean;
  mode: 'instances' | 'frames';
};

type NavigationTarget =
  | { type: 'batch'; batchStart: number }
  | { type: 'instance'; instanceDirection: 1 | -1; framePreset: 'start' | 'end' };

/**
 * One viewport / thumbnail slot: US image SOP (any frame count) or SR.
 * Multiframe US plays as cine; single-frame US is static; SR is its own slot.
 */
function isUsStudyViewportSlotDisplaySet(displaySet) {
  if (!displaySet || displaySet.unsupported) {
    return false;
  }

  if (displaySet.Modality === 'SR') {
    return true;
  }

  return displaySet.Modality === 'US' && (displaySet.numImageFrames ?? 0) >= 1;
}

function getUsStudyViewportSlotFromViewport(displaySetService, viewportState) {
  const displaySetInstanceUIDs = viewportState?.displaySetInstanceUIDs ?? [];

  return displaySetInstanceUIDs
    .map(uid => displaySetService.getDisplaySetByUID(uid))
    .find(isUsStudyViewportSlotDisplaySet);
}

function isHangableImageDisplaySet(displaySet) {
  if (!displaySet || displaySet.unsupported || displaySet.excludeFromThumbnailBrowser) {
    return false;
  }

  const modality = String(displaySet.Modality || '').toUpperCase();
  const nonImage = new Set(['SR', 'SEG', 'RTSTRUCT', 'RTPLAN', 'RTDOSE', 'DOC', 'PMAP', 'PR', 'KO']);
  if (nonImage.has(modality)) {
    return false;
  }

  const frames =
    displaySet.numImageFrames ?? displaySet.instances?.length ?? displaySet.imageIds?.length ?? 0;
  if (frames > 0) {
    return true;
  }

  return Array.isArray(displaySet.images) && displaySet.images.length > 0;
}

/** Series/instance that can occupy a layout tile for study-level paging. */
function isPageableStudyDisplaySet(displaySet) {
  return isUsStudyViewportSlotDisplaySet(displaySet) || isHangableImageDisplaySet(displaySet);
}

function getPageableDisplaySetFromViewport(displaySetService, viewportState) {
  const displaySetInstanceUIDs = viewportState?.displaySetInstanceUIDs ?? [];

  return displaySetInstanceUIDs
    .map(uid => displaySetService.getDisplaySetByUID(uid))
    .find(isPageableStudyDisplaySet);
}

/**
 * Pageable display sets in Study Panel order (all modalities).
 * Falls back to US/SR review order, then hangable panel images.
 */
function getPageableStudyDisplaySets(displaySetService, studyInstanceUID?: string) {
  const matchesStudy = (ds: any) =>
    !studyInstanceUID || ds?.StudyInstanceUID === studyInstanceUID;

  const panelOrderUIDs = getStudyPanelNavigationOrder();
  if (panelOrderUIDs.length) {
    const fromPanel = panelOrderUIDs
      .map(uid => {
        try {
          return displaySetService.getDisplaySetByUID(uid);
        } catch {
          return null;
        }
      })
      .filter(ds => ds && matchesStudy(ds) && isPageableStudyDisplaySet(ds));

    if (fromPanel.length) {
      return fromPanel;
    }
  }

  const usSlots = getAllCineCapableStudyDisplaySets(displaySetService, studyInstanceUID);
  if (usSlots.length) {
    return usSlots;
  }

  return getDisplaySetsInStudyPanelOrder(displaySetService).filter(matchesStudy);
}

function getFrameViewIndex(viewportState): number | null {
  const syncGroups = viewportState?.viewportOptions?.syncGroups ?? [];
  const groups = Array.isArray(syncGroups) ? syncGroups : [syncGroups];

  for (const group of groups) {
    const type = (typeof group === 'string' ? group : group?.type)?.toLowerCase();

    if (type === 'frameview') {
      const index = group?.options?.viewportIndex;

      return index != null ? Number(index) : 0;
    }
  }

  return null;
}

function getLayoutBatchSize(servicesManager: AppTypes.ServicesManager): number {
  return getUsLayoutGridSize(servicesManager);
}

function getLastBatchStart(totalCount: number, batchSize: number): number {
  if (totalCount <= batchSize) {
    return 0;
  }

  return Math.floor((totalCount - 1) / batchSize) * batchSize;
}

function getPageInfo(batchStart: number, batchSize: number, totalCount: number) {
  const totalPages = Math.max(1, Math.ceil(totalCount / batchSize));
  const currentPage = Math.min(totalPages, Math.floor(batchStart / batchSize) + 1);

  return {
    currentPage,
    totalPages,
    hasNextBatch: batchStart + batchSize < totalCount,
    hasPrevBatch: batchStart > 0,
  };
}

function sortCineDisplaySets(displaySets) {
  return [...displaySets].sort(utils.compareDisplaySetsByReviewOrder);
}

/**
 * All viewport slots for the study: every US SOP instance + SR, in review order.
 * Used for 2×2 (etc.) paging — not limited to multiframe/cine-only sets.
 */
function getAllCineCapableStudyDisplaySets(displaySetService, studyInstanceUID?: string) {
  const displaySets = displaySetService.activeDisplaySets.filter(
    ds =>
      isUsStudyViewportSlotDisplaySet(ds) &&
      (!studyInstanceUID || ds.StudyInstanceUID === studyInstanceUID)
  );

  return sortCineDisplaySets(displaySets);
}

function getAllUsStudyDisplaySets(displaySetService, studyInstanceUID?: string) {
  return getAllCineCapableStudyDisplaySets(displaySetService, studyInstanceUID);
}

function getUsSeriesDisplaySets(displaySetService, seriesInstanceUID: string) {
  const displaySets = displaySetService.activeDisplaySets.filter(
    ds => isUsStudyViewportSlotDisplaySet(ds) && ds?.SeriesInstanceUID === seriesInstanceUID
  );

  return sortCineDisplaySets(displaySets);
}

function getDisplaySetIndex(displaySets, displaySet) {
  return displaySets.findIndex(
    candidate => candidate.displaySetInstanceUID === displaySet.displaySetInstanceUID
  );
}

/**
 * Prefer a layout viewport that currently shows a pageable series.
 * Falls back to cine control viewport for frame-paging mode.
 */
function getUsBatchControlViewportId(servicesManager: AppTypes.ServicesManager): string | null {
  const layoutViewportIds = getUsLayoutViewportIds(servicesManager);
  const { displaySetService, viewportGridService } = servicesManager.services;
  const { viewports, activeViewportId } = viewportGridService.getState();

  if (activeViewportId && layoutViewportIds.includes(activeViewportId)) {
    const activeDs = getPageableDisplaySetFromViewport(
      displaySetService,
      viewports.get(activeViewportId)
    );

    if (activeDs) {
      return activeViewportId;
    }
  }

  for (const viewportId of layoutViewportIds) {
    const ds = getPageableDisplaySetFromViewport(displaySetService, viewports.get(viewportId));

    if (ds) {
      return viewportId;
    }
  }

  return getCineControlViewportId(servicesManager);
}

function resolveNavigationTarget(
  batchInfo: UsBatchNavigationInfo,
  direction: 1 | -1,
  wrap = true
): NavigationTarget | null {
  const { batchStart, batchSize, totalCount, mode } = batchInfo;
  const nextBatchStart = batchStart + direction * batchSize;

  if (direction === 1 && nextBatchStart >= totalCount) {
    if (batchSize === 1 && mode === 'frames') {
      return { type: 'instance', instanceDirection: 1, framePreset: 'start' };
    }

    return wrap ? { type: 'batch', batchStart: 0 } : null;
  }

  if (direction === -1 && nextBatchStart < 0) {
    if (batchSize === 1 && mode === 'frames') {
      return { type: 'instance', instanceDirection: -1, framePreset: 'end' };
    }

    return wrap
      ? { type: 'batch', batchStart: getLastBatchStart(totalCount, batchSize) }
      : null;
  }

  return { type: 'batch', batchStart: nextBatchStart };
}

function stopCineOnViewports(servicesManager: AppTypes.ServicesManager, viewportIds: string[]) {
  const { cineService, cornerstoneViewportService } = servicesManager.services;

  snapshotUsLayoutInstanceFrames(servicesManager);
  bumpCineGeneration();
  suppressCineAutoplay(2200);

  viewportIds.forEach(viewportId => {
    cineService.setCine({ id: viewportId, isPlaying: false });

    const element = getViewportEnabledElement(cornerstoneViewportService, viewportId);

    if (element) {
      cineService.stopClip(element, { viewportId });
    }
  });
}

function recoverLayoutAfterPage(servicesManager: AppTypes.ServicesManager): void {
  recoverLayoutStackViewports(
    servicesManager.services.cornerstoneViewportService,
    getUsLayoutViewportIds(servicesManager)
  );
}

function scheduleLayoutRecover(servicesManager: AppTypes.ServicesManager): void {
  [0, 120, 400, 900].forEach(ms => {
    window.setTimeout(() => recoverLayoutAfterPage(servicesManager), ms);
  });
}

function scheduleCineResumeAfterPaint(
  servicesManager: AppTypes.ServicesManager,
  wasPlaying: boolean
): void {
  if (!wasPlaying) {
    return;
  }

  const viewportIds = getUsLayoutViewportIds(servicesManager);
  const remaining = new Set(viewportIds);
  let finished = false;

  const finish = () => {
    if (finished) {
      return;
    }

    finished = true;
    eventTarget.removeEventListener(EVENTS.IMAGE_RENDERED, onRendered);
    window.clearTimeout(timeoutId);
    recoverLayoutAfterPage(servicesManager);

    const resume = () => {
      if (shouldSuppressCineAutoplay()) {
        window.setTimeout(resume, 200);
        return;
      }

      playAllUsViewports(servicesManager);
    };

    window.setTimeout(resume, 80);
  };

  const onRendered = (evt: Event) => {
    const viewportId = (evt as CustomEvent)?.detail?.viewportId;

    if (viewportId) {
      remaining.delete(viewportId);
    }

    if (remaining.size === 0) {
      finish();
    }
  };

  eventTarget.addEventListener(EVENTS.IMAGE_RENDERED, onRendered);

  const timeoutId = window.setTimeout(finish, 1800);
}

function applyFrameBatch(
  servicesManager: AppTypes.ServicesManager,
  orderedViewportIds: string[],
  batchStart: number,
  totalCount: number
) {
  const { viewportGridService, cornerstoneViewportService } = servicesManager.services;
  const { viewports } = viewportGridService.getState();

  orderedViewportIds.forEach((viewportId, index) => {
    const frameViewIndex = getFrameViewIndex(viewports.get(viewportId)) ?? index;
    const targetIndex = Math.min(batchStart + frameViewIndex, totalCount - 1);
    setViewportFrameIndexById(cornerstoneViewportService, viewportId, targetIndex);
  });
}

function applyInstanceBatch(
  servicesManager: AppTypes.ServicesManager,
  orderedViewportIds: string[],
  batchStart: number,
  studyDisplaySets
) {
  const { viewportGridService } = servicesManager.services;

  const viewportsToUpdate = orderedViewportIds.map((viewportId, index) => {
    const targetIndex = batchStart + index;

    if (targetIndex >= studyDisplaySets.length) {
      return {
        viewportId,
        displaySetInstanceUIDs: [],
      };
    }

    return {
      viewportId,
      displaySetInstanceUIDs: [studyDisplaySets[targetIndex].displaySetInstanceUID],
    };
  });

  if (viewportsToUpdate.length) {
    viewportGridService.setDisplaySetsForViewports(viewportsToUpdate);
  }
}

function navigateToAdjacentInstance(
  servicesManager: AppTypes.ServicesManager,
  controlViewportId: string,
  orderedViewportIds: string[],
  studyDisplaySets,
  currentDisplaySet,
  instanceDirection: 1 | -1,
  framePreset: 'start' | 'end',
  batchSize: number
) {
  const currentIndex = getDisplaySetIndex(studyDisplaySets, currentDisplaySet);

  if (currentIndex < 0) {
    return;
  }

  let nextIndex = currentIndex + instanceDirection;

  if (nextIndex < 0) {
    nextIndex = studyDisplaySets.length - 1;
  } else if (nextIndex >= studyDisplaySets.length) {
    nextIndex = 0;
  }

  const targetDisplaySet = studyDisplaySets[nextIndex];
  const numFrames = Number(targetDisplaySet.numImageFrames) || 1;
  const targetBatchStart = framePreset === 'end' ? getLastBatchStart(numFrames, batchSize) : 0;

  const { viewportGridService } = servicesManager.services;

  if (orderedViewportIds.length === 1) {
    viewportGridService.setDisplaySetsForViewports([
      {
        viewportId: controlViewportId,
        displaySetInstanceUIDs: [targetDisplaySet.displaySetInstanceUID],
      },
    ]);

    window.setTimeout(() => {
      applyFrameBatch(servicesManager, orderedViewportIds, targetBatchStart, numFrames);
    }, 400);

    return;
  }

  const instanceBatchStart = Math.max(
    0,
    Math.min(nextIndex, studyDisplaySets.length - orderedViewportIds.length)
  );

  applyInstanceBatch(servicesManager, orderedViewportIds, instanceBatchStart, studyDisplaySets);
}

function buildUsBatchNavigationInfo(
  servicesManager: AppTypes.ServicesManager
): UsBatchNavigationInfo | null {
  if (isUsFrameDistributionEnabled()) {
    return getUsFrameDistributionPageInfo(servicesManager);
  }

  const { displaySetService, viewportGridService, cornerstoneViewportService } =
    servicesManager.services;

  const layoutViewportIds = getUsLayoutViewportIds(servicesManager);
  const batchSize = getLayoutBatchSize(servicesManager);
  const controlViewportId = getUsBatchControlViewportId(servicesManager);

  if (!controlViewportId) {
    return null;
  }

  const { viewports } = viewportGridService.getState();
  const controlViewportState = viewports.get(controlViewportId);
  const controlSlotDisplaySet = getPageableDisplaySetFromViewport(
    displaySetService,
    controlViewportState
  );
  const controlCineDisplaySet = getCineDisplaySetFromViewport(
    displaySetService,
    controlViewportState
  );
  const studyUid =
    controlSlotDisplaySet?.StudyInstanceUID || controlCineDisplaySet?.StudyInstanceUID;

  if (!studyUid) {
    return null;
  }

  const studyDisplaySets = getPageableStudyDisplaySets(displaySetService, studyUid);
  // Page by series/SOP slot for every grid size. Leftover empty tiles on the last page stay valid.
  const isInstanceBatchMode = studyDisplaySets.length > 1;

  if (typeof window !== 'undefined') {
    const all = displaySetService.activeDisplaySets || [];
    const byModality = all.reduce((acc, ds) => {
      const key = ds.unsupported ? `unsupported:${ds.Modality || '?'}` : ds.Modality || 'other';
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});
    const inventoryKey = `${studyUid}:${studyDisplaySets.length}:${all.length}:${JSON.stringify(byModality)}`;

    if (inventoryKey !== lastPagingInventoryKey) {
      lastPagingInventoryKey = inventoryKey;
    }
  }

  if (isInstanceBatchMode) {
    const indices = layoutViewportIds
      .map(viewportId => {
        const ds = getPageableDisplaySetFromViewport(displaySetService, viewports.get(viewportId));

        if (!ds) {
          return -1;
        }

        return getDisplaySetIndex(studyDisplaySets, ds);
      })
      .filter(index => index >= 0);

    if (!indices.length || !studyDisplaySets.length) {
      return null;
    }

    // Snap to layout page boundaries so 2×2 / 1×2 / 1×1 pages stay aligned.
    const rawStart = Math.min(...indices);
    const gridBatchStart = Math.floor(rawStart / batchSize) * batchSize;
    const pendingBatchStart = getPendingInstanceBatchStart(studyUid, batchSize);

    if (pendingBatchStart === gridBatchStart) {
      pendingInstanceBatch = null;
    }

    const batchStart = pendingBatchStart ?? gridBatchStart;
    const totalCount = studyDisplaySets.length;
    const batchEnd = Math.min(batchStart + batchSize, totalCount);
    const pageInfo = getPageInfo(batchStart, batchSize, totalCount);

    const result = {
      batchSize,
      batchStart,
      batchEnd,
      totalCount,
      ...pageInfo,
      mode: 'instances' as const,
    };

    return result;
  }

  const controlDisplaySet = controlCineDisplaySet;
  const numFrames = Number(controlDisplaySet?.numImageFrames) || 0;

  if (numFrames <= 1) {
    return null;
  }

  const frameViewIndices = layoutViewportIds.map(viewportId => {
    const frameViewIndex = getFrameViewIndex(viewports.get(viewportId));

    return frameViewIndex ?? layoutViewportIds.indexOf(viewportId);
  });
  const sourceViewportId = layoutViewportIds[0];
  const sourceViewport = getAliveViewport(cornerstoneViewportService, sourceViewportId);
  const sourceFrameIndex = getViewportFrameIndex(sourceViewport);
  const sourceFrameViewIndex = frameViewIndices[0] ?? 0;
  const inferredBatchStart = Math.max(0, sourceFrameIndex - sourceFrameViewIndex);
  const batchStart = inferredBatchStart;
  const batchEnd = Math.min(batchStart + batchSize, numFrames);
  const pageInfo = getPageInfo(batchStart, batchSize, numFrames);

  const result = {
    batchSize,
    batchStart,
    batchEnd,
    totalCount: numFrames,
    ...pageInfo,
    mode: 'frames' as const,
  };

  return result;
}

function advanceUsBatch(
  servicesManager: AppTypes.ServicesManager,
  direction: 1 | -1 = 1,
  { wrap = true }: { wrap?: boolean } = {}
): UsBatchNavigationInfo | null {
  if (isUsFrameDistributionEnabled()) {
    const batchInfo = getUsFrameDistributionPageInfo(servicesManager);

    if (!batchInfo) {
      return null;
    }

    const target = resolveNavigationTarget(batchInfo, direction, wrap);

    if (!target) {
      return batchInfo;
    }

    const layoutViewportIds = getUsLayoutViewportIds(servicesManager);
    const { cineService } = servicesManager.services;
    const { cines } = cineService.getState();
    const wasPlaying = layoutViewportIds.some(viewportId => cines?.[viewportId]?.isPlaying);
    stopCineOnViewports(servicesManager, layoutViewportIds);

    if (target.type === 'batch') {
      setUsFrameDistributionBatchStart(target.batchStart);
      applyUsFrameDistribution(servicesManager, { force: true });
    }

    scheduleLayoutRecover(servicesManager);

    if (wasPlaying) {
      scheduleCineResumeAfterPaint(servicesManager, true);
    }

    return getUsFrameDistributionPageInfo(servicesManager);
  }

  const batchInfo = buildUsBatchNavigationInfo(servicesManager);

  if (!batchInfo) {
    return null;
  }

  const { displaySetService, viewportGridService } = servicesManager.services;
  const controlViewportId = getUsBatchControlViewportId(servicesManager);

  if (!controlViewportId) {
    return null;
  }

  const { viewports } = viewportGridService.getState();
  const layoutViewportIds = getUsLayoutViewportIds(servicesManager);
  const controlDisplaySet =
    getPageableDisplaySetFromViewport(displaySetService, viewports.get(controlViewportId)) ||
    getCineDisplaySetFromViewport(displaySetService, viewports.get(controlViewportId));

  if (!controlDisplaySet) {
    return null;
  }

  const target = resolveNavigationTarget(batchInfo, direction, wrap);

  if (!target) {
    return batchInfo;
  }

  // Resume play state after paging; each new display set re-derives its own FPS on load.
  const { cineService } = servicesManager.services;
  const { cines } = cineService.getState();
  const wasPlaying = layoutViewportIds.some(viewportId => cines?.[viewportId]?.isPlaying);

  stopCineOnViewports(servicesManager, layoutViewportIds);

  const studyDisplaySets = getPageableStudyDisplaySets(
    displaySetService,
    controlDisplaySet.StudyInstanceUID
  );

  const scheduleCineResume = () => {
    scheduleLayoutRecover(servicesManager);
    scheduleCineResumeAfterPaint(servicesManager, wasPlaying);
  };

  if (target.type === 'instance') {
    navigateToAdjacentInstance(
      servicesManager,
      controlViewportId,
      layoutViewportIds,
      studyDisplaySets,
      controlDisplaySet,
      target.instanceDirection,
      target.framePreset,
      batchInfo.batchSize
    );

    scheduleCineResume();
    return buildUsBatchNavigationInfo(servicesManager);
  }

  if (batchInfo.mode === 'instances') {
    pendingInstanceBatch = {
      studyUid: controlDisplaySet.StudyInstanceUID,
      batchSize: batchInfo.batchSize,
      batchStart: target.batchStart,
      at: Date.now(),
    };
    applyInstanceBatch(servicesManager, layoutViewportIds, target.batchStart, studyDisplaySets);
  } else {
    applyFrameBatch(servicesManager, layoutViewportIds, target.batchStart, batchInfo.totalCount);
  }

  scheduleCineResume();

  return buildUsBatchNavigationInfo(servicesManager);
}

/**
 * After a hanging-protocol layout change, re-assign viewports so they match
 * Study Panel thumbnail order (row-major: 1 2 / 3 4).
 */
function syncUsViewportGridToReviewOrder(servicesManager: AppTypes.ServicesManager): boolean {
  if (isUsFrameDistributionEnabled()) {
    return false;
  }

  return syncViewportGridToStudyPanelOrder(servicesManager);
}

function getUsSeriesPositionInStudy(
  servicesManager: AppTypes.ServicesManager,
  viewportId: string
): { seriesIndex: number; totalSeries: number } | null {
  const { displaySetService, viewportGridService } = servicesManager.services;
  const { viewports } = viewportGridService.getState();
  const displaySet =
    getPageableDisplaySetFromViewport(displaySetService, viewports.get(viewportId)) ||
    getCineDisplaySetFromViewport(displaySetService, viewports.get(viewportId));

  if (!displaySet) {
    return null;
  }

  const studyDisplaySets = getPageableStudyDisplaySets(
    displaySetService,
    displaySet.StudyInstanceUID
  );
  const seriesIndex = getDisplaySetIndex(studyDisplaySets, displaySet);

  if (seriesIndex < 0 || !studyDisplaySets.length) {
    return null;
  }

  return {
    seriesIndex: seriesIndex + 1,
    totalSeries: studyDisplaySets.length,
  };
}

export {
  advanceUsBatch,
  applyFrameBatch,
  buildUsBatchNavigationInfo,
  getAllUsStudyDisplaySets,
  getLayoutBatchSize,
  getUsSeriesPositionInStudy,
  shouldSuppressCineAutoplay,
  syncUsViewportGridToReviewOrder,
};
export type { UsBatchNavigationInfo };
