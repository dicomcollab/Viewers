import { utilities as csUtils } from '@cornerstonejs/core';
import {
  getCineControlViewportId,
  getSyncedCineViewportIds,
  getViewportEnabledElement,
} from './cineSyncUtils';

type UsBatchNavigationInfo = {
  batchSize: number;
  batchStart: number;
  batchEnd: number;
  totalCount: number;
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

function getOrderedCineViewportIds(
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

function getLayoutBatchSize(servicesManager: AppTypes.ServicesManager, viewportCount: number): number {
  const { layout } = servicesManager.services.viewportGridService.getState();
  const gridSize = (layout?.numRows ?? 1) * (layout?.numCols ?? 1);

  return Math.max(1, Math.min(gridSize, viewportCount || gridSize));
}

function getLastBatchStart(totalCount: number, batchSize: number): number {
  if (totalCount <= batchSize) {
    return 0;
  }

  return Math.floor((totalCount - 1) / batchSize) * batchSize;
}

function getUsDisplaySetFromViewport(displaySetService, viewportState) {
  const displaySetInstanceUIDs = viewportState?.displaySetInstanceUIDs ?? [];

  return displaySetInstanceUIDs
    .map(uid => displaySetService.getDisplaySetByUID(uid))
    .find(ds => ds?.Modality === 'US' && (ds?.numImageFrames ?? 0) > 0);
}

function sortUsSeriesDisplaySets(displaySets) {
  return [...displaySets].sort((a, b) => {
    const aNum = Number(a.instanceNumber ?? a.InstanceNumber ?? 0);
    const bNum = Number(b.instanceNumber ?? b.InstanceNumber ?? 0);

    if (aNum !== bNum) {
      return aNum - bNum;
    }

    return String(a.displaySetInstanceUID).localeCompare(String(b.displaySetInstanceUID));
  });
}

function getUsSeriesDisplaySets(displaySetService, seriesInstanceUID: string) {
  const displaySets = displaySetService.activeDisplaySets.filter(
    ds =>
      ds?.Modality === 'US' &&
      ds?.SeriesInstanceUID === seriesInstanceUID &&
      (ds?.numImageFrames ?? 0) > 0
  );

  return sortUsSeriesDisplaySets(displaySets);
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

    if (batchSize === 1 && mode === 'instances') {
      return { type: 'batch', batchStart: 0 };
    }

    return { type: 'batch', batchStart: 0 };
  }

  if (direction === -1 && nextBatchStart < 0) {
    if (batchSize === 1 && mode === 'frames') {
      return { type: 'instance', instanceDirection: -1, framePreset: 'end' };
    }

    if (batchSize === 1 && mode === 'instances') {
      return { type: 'batch', batchStart: totalCount - 1 };
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
    const viewport = cornerstoneViewportService.getCornerstoneViewport(viewportId);
    const element = viewport?.element;

    if (!element) {
      return;
    }

    csUtils.jumpToSlice(element, {
      imageIndex: targetIndex,
      debounceLoading: false,
    });
  });
}

function applyInstanceBatch(
  servicesManager: AppTypes.ServicesManager,
  orderedViewportIds: string[],
  batchStart: number,
  seriesDisplaySets
) {
  const { viewportGridService } = servicesManager.services;

  const viewportsToUpdate = orderedViewportIds
    .map((viewportId, index) => {
      const targetIndex = batchStart + index;

      if (targetIndex >= seriesDisplaySets.length) {
        return null;
      }

      return {
        viewportId,
        displaySetInstanceUIDs: [seriesDisplaySets[targetIndex].displaySetInstanceUID],
      };
    })
    .filter(Boolean);

  if (viewportsToUpdate.length) {
    viewportGridService.setDisplaySetsForViewports(viewportsToUpdate);
  }
}

function navigateToAdjacentInstance(
  servicesManager: AppTypes.ServicesManager,
  controlViewportId: string,
  orderedViewportIds: string[],
  seriesDisplaySets,
  currentDisplaySet,
  instanceDirection: 1 | -1,
  framePreset: 'start' | 'end',
  batchSize: number
) {
  const currentIndex = seriesDisplaySets.findIndex(
    ds => ds.displaySetInstanceUID === currentDisplaySet.displaySetInstanceUID
  );

  if (currentIndex < 0) {
    return;
  }

  let nextIndex = currentIndex + instanceDirection;

  if (nextIndex < 0) {
    nextIndex = seriesDisplaySets.length - 1;
  } else if (nextIndex >= seriesDisplaySets.length) {
    nextIndex = 0;
  }

  const targetDisplaySet = seriesDisplaySets[nextIndex];
  const numFrames = Number(targetDisplaySet.numImageFrames) || 1;
  const targetBatchStart =
    framePreset === 'end' ? getLastBatchStart(numFrames, batchSize) : 0;

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
    Math.min(nextIndex, seriesDisplaySets.length - orderedViewportIds.length)
  );

  applyInstanceBatch(servicesManager, orderedViewportIds, instanceBatchStart, seriesDisplaySets);
}

function buildUsBatchNavigationInfo(servicesManager: AppTypes.ServicesManager): UsBatchNavigationInfo | null {
  const { displaySetService, viewportGridService, cornerstoneViewportService } =
    servicesManager.services;

  const controlViewportId = getCineControlViewportId(servicesManager);

  if (!controlViewportId) {
    return null;
  }

  const { viewports } = viewportGridService.getState();
  const controlViewportState = viewports.get(controlViewportId);
  const controlDisplaySet = getUsDisplaySetFromViewport(displaySetService, controlViewportState);

  if (!controlDisplaySet) {
    return null;
  }

  const orderedViewportIds = getOrderedCineViewportIds(servicesManager, controlViewportId);
  const batchSize = getLayoutBatchSize(servicesManager, orderedViewportIds.length);
  const viewportDisplaySets = orderedViewportIds
    .map(viewportId => getUsDisplaySetFromViewport(displaySetService, viewports.get(viewportId)))
    .filter(Boolean);

  const uniqueDisplaySetUIDs = new Set(viewportDisplaySets.map(ds => ds.displaySetInstanceUID));
  const isInstanceBatchMode = uniqueDisplaySetUIDs.size > 1;
  const seriesDisplaySets = getUsSeriesDisplaySets(
    displaySetService,
    controlDisplaySet.SeriesInstanceUID
  );
  const hasMultipleInstances = seriesDisplaySets.length > 1;

  if (isInstanceBatchMode) {
    const indices = orderedViewportIds
      .map(viewportId => {
        const ds = getUsDisplaySetFromViewport(displaySetService, viewports.get(viewportId));

        if (!ds) {
          return -1;
        }

        return seriesDisplaySets.findIndex(
          candidate => candidate.displaySetInstanceUID === ds.displaySetInstanceUID
        );
      })
      .filter(index => index >= 0);

    if (!indices.length) {
      return null;
    }

    const batchStart = Math.min(...indices);
    const totalCount = seriesDisplaySets.length;
    const batchEnd = Math.min(batchStart + batchSize, totalCount);

    return {
      batchSize,
      batchStart,
      batchEnd,
      totalCount,
      hasNextBatch: true,
      hasPrevBatch: true,
      mode: 'instances',
    };
  }

  const numFrames = Number(controlDisplaySet.numImageFrames) || 0;

  if (numFrames <= 1) {
    if (!hasMultipleInstances) {
      return null;
    }

    const currentIndex = seriesDisplaySets.findIndex(
      ds => ds.displaySetInstanceUID === controlDisplaySet.displaySetInstanceUID
    );

    if (currentIndex < 0) {
      return null;
    }

    return {
      batchSize: 1,
      batchStart: currentIndex,
      batchEnd: currentIndex + 1,
      totalCount: seriesDisplaySets.length,
      hasNextBatch: true,
      hasPrevBatch: true,
      mode: 'instances',
    };
  }

  const frameViewIndices = orderedViewportIds.map(viewportId => {
    const frameViewIndex = getFrameViewIndex(viewports.get(viewportId));

    return frameViewIndex ?? orderedViewportIds.indexOf(viewportId);
  });
  const sourceViewportId = orderedViewportIds[0];
  const sourceViewport = cornerstoneViewportService.getCornerstoneViewport(sourceViewportId);
  const sourceFrameIndex = sourceViewport?.getCurrentImageIdIndex?.() ?? 0;
  const sourceFrameViewIndex = frameViewIndices[0] ?? 0;
  const batchStart = Math.max(0, sourceFrameIndex - sourceFrameViewIndex);
  const batchEnd = Math.min(batchStart + batchSize, numFrames);

  return {
    batchSize,
    batchStart,
    batchEnd,
    totalCount: numFrames,
    hasNextBatch: true,
    hasPrevBatch: true,
    mode: 'frames',
  };
}

function advanceUsBatch(
  servicesManager: AppTypes.ServicesManager,
  direction: 1 | -1 = 1
): UsBatchNavigationInfo | null {
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
  const orderedViewportIds = getOrderedCineViewportIds(servicesManager, controlViewportId);
  const controlDisplaySet = getUsDisplaySetFromViewport(
    displaySetService,
    viewports.get(controlViewportId)
  );

  if (!controlDisplaySet) {
    return null;
  }

  stopCineOnViewports(servicesManager, orderedViewportIds);

  const target = resolveNavigationTarget(batchInfo, direction);
  const seriesDisplaySets = getUsSeriesDisplaySets(
    displaySetService,
    controlDisplaySet.SeriesInstanceUID
  );

  if (target.type === 'instance') {
    navigateToAdjacentInstance(
      servicesManager,
      controlViewportId,
      orderedViewportIds,
      seriesDisplaySets,
      controlDisplaySet,
      target.instanceDirection,
      target.framePreset,
      batchInfo.batchSize
    );

    return batchInfo;
  }

  if (batchInfo.mode === 'instances') {
    applyInstanceBatch(
      servicesManager,
      orderedViewportIds,
      target.batchStart,
      seriesDisplaySets
    );
  } else {
    applyFrameBatch(
      servicesManager,
      orderedViewportIds,
      target.batchStart,
      batchInfo.totalCount
    );
  }

  return buildUsBatchNavigationInfo(servicesManager);
}

export {
  advanceUsBatch,
  buildUsBatchNavigationInfo,
  getLayoutBatchSize,
  getOrderedCineViewportIds,
};
export type { UsBatchNavigationInfo };
