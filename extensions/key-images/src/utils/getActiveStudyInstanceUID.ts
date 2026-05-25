/**
 * Resolves the study the user is currently working with.
 * Prefers hanging-protocol active study, then the active viewport display set.
 */
export function getActiveStudyInstanceUID(servicesManager: AppTypes.ServicesManager): string | null {
  const { hangingProtocolService, viewportGridService, displaySetService } =
    servicesManager.services as AppTypes.Services;

  const hpActiveStudyUID = hangingProtocolService?.getState?.()?.activeStudyUID;
  if (hpActiveStudyUID) {
    return hpActiveStudyUID;
  }

  const activeViewportId = viewportGridService?.getActiveViewportId?.();
  if (!activeViewportId) {
    return null;
  }

  const displaySetUIDs = viewportGridService.getDisplaySetsUIDsForViewport(activeViewportId) || [];
  for (const uid of displaySetUIDs) {
    const displaySet = displaySetService.getDisplaySetByUID(uid);
    const studyUID = displaySet?.StudyInstanceUID;
    if (studyUID) {
      return studyUID;
    }
  }

  return null;
}
