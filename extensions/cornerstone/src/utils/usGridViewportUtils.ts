import { viewportSupportsCine } from './cineSyncUtils';

/**
 * All viewport ids in the current grid, sorted top-to-bottom then left-to-right.
 */
function getUsLayoutViewportIds(servicesManager: AppTypes.ServicesManager): string[] {
  const { viewports } = servicesManager.services.viewportGridService.getState();

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
  const { layout } = servicesManager.services.viewportGridService.getState();

  return Math.max(1, (layout?.numRows ?? 1) * (layout?.numCols ?? 1));
}

function getUsCineCapableLayoutViewportIds(servicesManager: AppTypes.ServicesManager): string[] {
  const { displaySetService } = servicesManager.services;

  return getUsLayoutViewportIds(servicesManager).filter(viewportId => {
    const { viewports } = servicesManager.services.viewportGridService.getState();
    return viewportSupportsCine(displaySetService, viewports.get(viewportId));
  });
}

export { getUsCineCapableLayoutViewportIds, getUsLayoutGridSize, getUsLayoutViewportIds };
