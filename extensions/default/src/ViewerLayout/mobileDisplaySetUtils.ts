const NON_IMAGE = new Set(['SR', 'SEG', 'SM', 'RTSTRUCT', 'RTPLAN', 'RTDOSE', 'DOC', 'KO', 'PR']);

export function getMobileImageDisplaySets(displaySetService: AppTypes.DisplaySetService) {
  const all =
    displaySetService.getActiveDisplaySets?.() || displaySetService.activeDisplaySets || [];
  return all.filter(ds => ds && !NON_IMAGE.has(ds.Modality) && !ds.excludeFromThumbnailBrowser);
}

export function getActiveDisplaySetUID(viewportGridService: AppTypes.ViewportGridService): string | null {
  const { activeViewportId, viewports } = viewportGridService.getState();
  const vp = viewports?.get?.(activeViewportId);
  return vp?.displaySetInstanceUIDs?.[0] ?? null;
}

export function selectDisplaySetInActiveViewport({
  commandsManager,
  viewportGridService,
  displaySetInstanceUID,
}: {
  commandsManager: AppTypes.CommandsManager;
  viewportGridService: AppTypes.ViewportGridService;
  displaySetInstanceUID: string;
}) {
  const { activeViewportId } = viewportGridService.getState();
  if (!activeViewportId || !displaySetInstanceUID) {
    return;
  }
  commandsManager.run('setDisplaySetsForViewports', {
    viewportsToUpdate: [
      {
        viewportId: activeViewportId,
        displaySetInstanceUIDs: [displaySetInstanceUID],
      },
    ],
  });
}

export function navigateSeries({
  commandsManager,
  direction,
}: {
  commandsManager: AppTypes.CommandsManager;
  direction: 1 | -1;
}) {
  commandsManager.run('updateViewportDisplaySet', {
    direction,
    excludeNonImageModalities: true,
  });
}

export { NON_IMAGE };
