import {
  getCineControlViewportId,
  getCineDisplaySetFromViewport,
  getViewportEnabledElement,
  isCineCapableDisplaySet,
} from './cineSyncUtils';
import { getAliveViewport, getViewportFrameIndex, setViewportFrameIndexById } from './safeViewportFrameUtils';
import { playAllUsViewports } from './usCinePlaybackUtils';
import { getUsLayoutGridSize, getUsLayoutViewportIds } from './usGridViewportUtils';
import {
  isUsFrameDistributionEnabled,
  setUsFrameDistributionBatchStart,
} from '@ohif/extension-default';
import {
  applyUsFrameDistribution,
  getUsFrameDistributionPageInfo,
} from './usFrameDistributionUtils';

/** While paging, CinePlayer must not force autoplay; resume only if play was already on. */
let suppressCineAutoplayUntil = 0;

function shouldSuppressCineAutoplay(): boolean {
  return Date.now() < suppressCineAutoplayUntil;
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
  return [...displaySets].sort((a, b) => {
    const aSeries = Number(a.SeriesNumber ?? 0);
    const bSeries = Number(b.SeriesNumber ?? 0);

    if (aSeries !== bSeries) {
      return aSeries - bSeries;
    }

    const aNum = Number(a.instanceNumber ?? a.InstanceNumber ?? 0);
    const bNum = Number(b.instanceNumber ?? b.InstanceNumber ?? 0);

    if (aNum !== bNum) {
      return aNum - bNum;
    }

    return String(a.displaySetInstanceUID).localeCompare(String(b.displaySetInstanceUID));
  });
}

/**
 * All cine-capable display sets in the active study, sorted by series number.
 * Used for multi-series layouts where each viewport shows a different series.
 */
function getAllCineCapableStudyDisplaySets(displaySetService, studyInstanceUID?: string) {
  const displaySets = displaySetService.activeDisplaySets.filter(
    ds =>
      isCineCapableDisplaySet(ds) &&
      (!studyInstanceUID || ds.StudyInstanceUID === studyInstanceUID)
  );

  return sortCineDisplaySets(displaySets);
}

function getAllUsStudyDisplaySets(displaySetService, studyInstanceUID?: string) {
  return getAllCineCapableStudyDisplaySets(displaySetService, studyInstanceUID);
}

function getUsSeriesDisplaySets(displaySetService, seriesInstanceUID: string) {
  const displaySets = displaySetService.activeDisplaySets.filter(
    ds =>
      isCineCapableDisplaySet(ds) &&
      ds?.SeriesInstanceUID === seriesInstanceUID
  );

  return sortCineDisplaySets(displaySets);
}

function getDisplaySetIndex(displaySets, displaySet) {
  return displaySets.findIndex(
    candidate => candidate.displaySetInstanceUID === displaySet.displaySetInstanceUID
  );
}

function resolveNavigationTarget(
  batchInfo: UsBatchNavigationInfo,
  direction: 1 | -1
): NavigationTarget {
  const { batchStart, batchSize, totalCount, mode } = batchInfo;
  const nextBatchStart = batchStart + direction * batchSize;

  if (direction === 1 && nextBatchStart >= totalCount) {
    if (batchSize === 1 && mode === 'frames') {
      return { type: 'instance', instanceDirection: 1, framePreset: 'start' };
    }

    return { type: 'batch', batchStart: 0 };
  }

  if (direction === -1 && nextBatchStart < 0) {
    if (batchSize === 1 && mode === 'frames') {
      return { type: 'instance', instanceDirection: -1, framePreset: 'end' };
    }

    return { type: 'batch', batchStart: getLastBatchStart(totalCount, batchSize) };
  }

  return { type: 'batch', batchStart: nextBatchStart };
}

function stopCineOnViewports(servicesManager: AppTypes.ServicesManager, viewportIds: string[]) {
  const { cineService, cornerstoneViewportService } = servicesManager.services;

  viewportIds.forEach(viewportId => {
    cineService.setCine({ id: viewportId, isPlaying: false });

    const element = getViewportEnabledElement(cornerstoneViewportService, viewportId);

    if (element) {
      cineService.stopClip(element, { viewportId });
    }
  });
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

function buildUsBatchNavigationInfo(servicesManager: AppTypes.ServicesManager): UsBatchNavigationInfo | null {
  if (isUsFrameDistributionEnabled()) {
    return getUsFrameDistributionPageInfo(servicesManager);
  }

  const { displaySetService, viewportGridService, cornerstoneViewportService } =
    servicesManager.services;

  const controlViewportId = getCineControlViewportId(servicesManager);

  if (!controlViewportId) {
    return null;
  }

  const { viewports } = viewportGridService.getState();
  const controlViewportState = viewports.get(controlViewportId);
  const controlDisplaySet = getCineDisplaySetFromViewport(displaySetService, controlViewportState);

  if (!controlDisplaySet) {
    return null;
  }

  const layoutViewportIds = getUsLayoutViewportIds(servicesManager);
  const batchSize = getLayoutBatchSize(servicesManager);
  const studyDisplaySets = getAllCineCapableStudyDisplaySets(
    displaySetService,
    controlDisplaySet.StudyInstanceUID
  );
  const numFrames = Number(controlDisplaySet.numImageFrames) || 0;
  // Page by instance for every grid size (1×1, 1×2, 2×2, 2×4). Last pages with
  // empty leftover tiles must stay in this mode or the HP pager is hidden.
  const isInstanceBatchMode = studyDisplaySets.length > 1;

  if (isInstanceBatchMode) {
    const indices = layoutViewportIds
      .map(viewportId => {
        const ds = getCineDisplaySetFromViewport(displaySetService, viewports.get(viewportId));

        if (!ds) {
          return -1;
        }

        return getDisplaySetIndex(studyDisplaySets, ds);
      })
      .filter(index => index >= 0);

    if (!indices.length || !studyDisplaySets.length) {
      return null;
    }

    const batchStart = Math.min(...indices);
    const totalCount = studyDisplaySets.length;
    const batchEnd = Math.min(batchStart + batchSize, totalCount);
    const pageInfo = getPageInfo(batchStart, batchSize, totalCount);

    return {
      batchSize,
      batchStart,
      batchEnd,
      totalCount,
      ...pageInfo,
      mode: 'instances',
    };
  }

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

  return {
    batchSize,
    batchStart,
    batchEnd,
    totalCount: numFrames,
    ...pageInfo,
    mode: 'frames',
  };
}

function advanceUsBatch(
  servicesManager: AppTypes.ServicesManager,
  direction: 1 | -1 = 1
): UsBatchNavigationInfo | null {
  if (isUsFrameDistributionEnabled()) {
    const batchInfo = getUsFrameDistributionPageInfo(servicesManager);

    if (!batchInfo) {
      return null;
    }

    const layoutViewportIds = getUsLayoutViewportIds(servicesManager);
    const { cineService } = servicesManager.services;
    const { cines } = cineService.getState();
    const wasPlaying = layoutViewportIds.some(viewportId => cines?.[viewportId]?.isPlaying);
    suppressCineAutoplayUntil = Date.now() + 700;
    stopCineOnViewports(servicesManager, layoutViewportIds);

    const target = resolveNavigationTarget(batchInfo, direction);

    if (target.type === 'batch') {
      setUsFrameDistributionBatchStart(target.batchStart);
      applyUsFrameDistribution(servicesManager, { force: true });
    }

    if (wasPlaying) {
      window.setTimeout(() => playAllUsViewports(servicesManager), 50);
      window.setTimeout(() => playAllUsViewports(servicesManager), 450);
    }

    return getUsFrameDistributionPageInfo(servicesManager);
  }

  const batchInfo = buildUsBatchNavigationInfo(servicesManager);

  if (!batchInfo) {
    return null;
  }

  const { displaySetService, viewportGridService } = servicesManager.services;
  const controlViewportId = getCineControlViewportId(servicesManager);

  if (!controlViewportId) {
    return null;
  }

  const { viewports } = viewportGridService.getState();
  const layoutViewportIds = getUsLayoutViewportIds(servicesManager);
  const controlDisplaySet = getCineDisplaySetFromViewport(
    displaySetService,
    viewports.get(controlViewportId)
  );

  if (!controlDisplaySet) {
    return null;
  }

  // Resume play state after paging; each new display set re-derives its own FPS on load.
  const { cineService } = servicesManager.services;
  const { cines } = cineService.getState();
  const wasPlaying = layoutViewportIds.some(viewportId => cines?.[viewportId]?.isPlaying);
  suppressCineAutoplayUntil = Date.now() + 700;

  stopCineOnViewports(servicesManager, layoutViewportIds);

  const target = resolveNavigationTarget(batchInfo, direction);
  const studyDisplaySets = getAllCineCapableStudyDisplaySets(
    displaySetService,
    controlDisplaySet.StudyInstanceUID
  );

  const resumePlayIfNeeded = () => {
    if (!wasPlaying) {
      return;
    }

    cineService.setIsCineEnabled(true);
    playAllUsViewports(servicesManager);
  };

  const scheduleCineResume = () => {
    // Let React process the pause from stopCine / display-set swap before restarting.
    window.setTimeout(resumePlayIfNeeded, 50);
    window.setTimeout(resumePlayIfNeeded, 450);
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
    applyInstanceBatch(servicesManager, layoutViewportIds, target.batchStart, studyDisplaySets);
  } else {
    applyFrameBatch(
      servicesManager,
      layoutViewportIds,
      target.batchStart,
      batchInfo.totalCount
    );
  }

  scheduleCineResume();

  return buildUsBatchNavigationInfo(servicesManager);
}

function getUsSeriesPositionInStudy(
  servicesManager: AppTypes.ServicesManager,
  viewportId: string
): { seriesIndex: number; totalSeries: number } | null {
  const { displaySetService, viewportGridService } = servicesManager.services;
  const { viewports } = viewportGridService.getState();
  const displaySet = getCineDisplaySetFromViewport(displaySetService, viewports.get(viewportId));

  if (!displaySet) {
    return null;
  }

  const studyDisplaySets = getAllUsStudyDisplaySets(
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
};
export type { UsBatchNavigationInfo };
