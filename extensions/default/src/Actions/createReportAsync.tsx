import { DicomMetadataStore } from '@ohif/core';

/**
 *
 * @param {*} servicesManager
 */
async function createReportAsync({
  servicesManager,
  getReport,
  reportType = 'measurement',
}: withAppTypes) {
  const { displaySetService, uiNotificationService, uiDialogService } = servicesManager.services;

  try {
    const naturalizedReport = await getReport();

    if (!naturalizedReport) {
      return;
    }

    // The "Mode" route listens for DicomMetadataStore changes
    // When a new instance is added, it listens and
    // automatically calls makeDisplaySets
    DicomMetadataStore.addInstances([naturalizedReport], true);

    const displaySet = await _findCreatedReportDisplaySet(displaySetService, naturalizedReport);
    const displaySetInstanceUID = displaySet?.displaySetInstanceUID;

    uiNotificationService.show({
      title: 'Create Report',
      message: `${reportType} saved successfully`,
      type: 'success',
    });

    return displaySetInstanceUID ? [displaySetInstanceUID] : [];
  } catch (error) {
    uiNotificationService.show({
      title: 'Create Report',
      message: error.message || `Failed to store ${reportType}`,
      type: 'error',
    });
    throw new Error(`Failed to store ${reportType}. Error: ${error.message || 'Unknown error'}`);
  } finally {
    uiDialogService.hide('loading-dialog');
  }
}

async function _findCreatedReportDisplaySet(displaySetService, naturalizedReport) {
  const { SOPInstanceUID, SeriesInstanceUID } = naturalizedReport || {};

  if (SOPInstanceUID) {
    const bySop = displaySetService.getDisplaySetForSOPInstanceUID(SOPInstanceUID, SeriesInstanceUID);
    if (bySop) {
      return bySop;
    }
  }

  if (SeriesInstanceUID) {
    const bySeries = displaySetService.getDisplaySetsForSeries(SeriesInstanceUID)?.[0];
    if (bySeries) {
      return bySeries;
    }
  }

  return new Promise(resolve => {
    const timeout = window.setTimeout(() => {
      subscription?.unsubscribe?.();
      resolve(displaySetService.getMostRecentDisplaySet());
    }, 1500);

    const subscription = displaySetService.subscribe(
      displaySetService.EVENTS.DISPLAY_SETS_ADDED,
      ({ displaySetsAdded }) => {
        const matchingDisplaySet = displaySetsAdded?.find(displaySet => {
          if (SOPInstanceUID && displaySet?.SOPInstanceUID === SOPInstanceUID) {
            return true;
          }
          if (SeriesInstanceUID && displaySet?.SeriesInstanceUID === SeriesInstanceUID) {
            return true;
          }
          return displaySet?.Modality === 'SR';
        });

        if (matchingDisplaySet) {
          window.clearTimeout(timeout);
          subscription?.unsubscribe?.();
          resolve(matchingDisplaySet);
        }
      }
    );
  });
}

export default createReportAsync;
