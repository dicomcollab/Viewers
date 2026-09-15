import {
  getCineDisplaySetFromViewport,
  isUsMultiframeDisplaySet,
} from './cineSyncUtils';

const EMPTY_GRID_STATE = {
  viewports: new Map<string, AppTypes.ViewportGrid.Viewport>(),
  layout: {
    numRows: 0,
    numCols: 0,
  },
};

function getViewportGridState(servicesManager: AppTypes.ServicesManager) {
  try {
    const state = servicesManager?.services?.viewportGridService?.getState?.();

    if (!state) {
      return EMPTY_GRID_STATE;
    }

    return {
      viewports: state.viewports ?? EMPTY_GRID_STATE.viewports,
      layout: state.layout ?? EMPTY_GRID_STATE.layout,
    };
  } catch {
    return EMPTY_GRID_STATE;
  }
}

/**
 * All viewport ids in the current grid, sorted top-to-bottom then left-to-right.
 */
function getUsLayoutViewportIds(servicesManager: AppTypes.ServicesManager): string[] {
  const { viewports } = getViewportGridState(servicesManager);

  return Array.from(viewports.entries())
    .sort(([, a], [, b]) => {
      const rowDiff = (a.y ?? 0) - (b.y ?? 0);

      if (rowDiff !== 0) {
        return rowDiff;
      }

      return (a.x ?? 0) - (b.x ?? 0);
    })
    .map(([viewportId]) => viewportId);
}

function getUsLayoutGridSize(servicesManager: AppTypes.ServicesManager): number {
  const { layout } = getViewportGridState(servicesManager);

  return Math.max(1, (layout?.numRows ?? 1) * (layout?.numCols ?? 1));
}

/**
 * Cine-capable viewports that are ultrasound multiframe only.
 * CT/MR multi-slice stacks must not be treated as US cine (no autoplay / sync).
 */
function getUsCineCapableLayoutViewportIds(servicesManager: AppTypes.ServicesManager): string[] {
  const { displaySetService } = servicesManager.services;
  const { viewports } = getViewportGridState(servicesManager);

  return getUsLayoutViewportIds(servicesManager).filter(viewportId => {
    const displaySet = getCineDisplaySetFromViewport(
      displaySetService,
      viewports.get(viewportId)
    );
    return isUsMultiframeDisplaySet(displaySet);
  });
}

export { getUsCineCapableLayoutViewportIds, getUsLayoutGridSize, getUsLayoutViewportIds };
