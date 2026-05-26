import { utils } from '@ohif/core';

import createReportAsync from '../Actions/createReportAsync';
import { createReportDialogPrompt } from '../Panels';
import PROMPT_RESPONSES from './_shared/PROMPT_RESPONSES';

const { filterAnd, filterMeasurementsByStudyUID, filterMeasurementsBySeriesUID } =
  utils.MeasurementFilters;

async function promptSaveReport({ servicesManager, commandsManager, extensionManager }, ctx, evt) {
  const { measurementService, displaySetService } = servicesManager.services;
  const viewportId = evt.viewportId === undefined ? evt.data.viewportId : evt.viewportId;
  const isBackupSave =
    evt.isBackupSave === undefined
      ? (evt.data?.isBackupSave ?? false)
      : (evt.isBackupSave ?? false);
  const StudyInstanceUID = evt?.data?.StudyInstanceUID || ctx.trackedStudy;
  const SeriesInstanceUID = evt?.data?.SeriesInstanceUID;
  const { displaySetInstanceUID } = evt.data ?? evt;

  const {
    trackedSeries,
    measurementFilter = filterAnd(
      filterMeasurementsByStudyUID(StudyInstanceUID),
      filterMeasurementsBySeriesUID(trackedSeries)
    ),
    defaultSaveTitle = 'Create Report',
  } = ctx;
  let displaySetInstanceUIDs;
  let createdSRSOPInstanceUID;

  const measurementData = measurementService.getMeasurements(measurementFilter);
  const predecessorImageId = findPredecessorImageId(measurementData);

  try {
    const promptResult = await createReportDialogPrompt({
      title: defaultSaveTitle,
      predecessorImageId,
      minSeriesNumber: 3000,
      extensionManager,
      servicesManager,
      enableDownload: true,
    });

    if (promptResult.action === PROMPT_RESPONSES.CREATE_REPORT) {
      const { series, priorSeriesNumber, value: reportName, dataSourceName } = promptResult;
      const SeriesDescription = reportName || defaultSaveTitle;

      const getReport = async () =>
        commandsManager.runCommand(
          'storeMeasurements',
          {
            measurementData,
            dataSource: dataSourceName,
            additionalFindingTypes: ['ArrowAnnotate'],
            options: {
              SeriesDescription,
              SeriesNumber: 1 + priorSeriesNumber,
              predecessorImageId: series,
            },
          },
          'CORNERSTONE_STRUCTURED_REPORT'
        );

      displaySetInstanceUIDs = await createReportAsync({
        servicesManager,
        getReport,
        dataSource,
      });

      const createdDisplaySetUID = displaySetInstanceUIDs?.[0];
      if (createdDisplaySetUID) {
        const createdDisplaySet = displaySetService.getDisplaySetByUID(createdDisplaySetUID);
        createdSRSOPInstanceUID = createdDisplaySet?.SOPInstanceUID;

        // Force a full refresh after SR creation so the viewer re-initializes
        // against server-side metadata/instances and opens SR consistently.
        window.setTimeout(() => {
          window.location.reload();
        }, 150);
      }
    } else if (promptResult.action === PROMPT_RESPONSES.CANCEL) {
      // Do nothing
    }

    return {
      userResponse: promptResult.action,
      createdDisplaySetInstanceUIDs: displaySetInstanceUIDs,
      createdSRSOPInstanceUID,
      StudyInstanceUID,
      SeriesInstanceUID,
      viewportId,
      isBackupSave,
      displaySetInstanceUID,
    };
  } catch (error) {
    console.warn('Unable to save report', error);
    return null;
  }
}

export function findPredecessorImageId(annotations) {
  let predecessorImageId;
  for (const annotation of annotations) {
    if (
      predecessorImageId &&
      annotation.predecessorImageId &&
      annotation.predecessorImageId !== predecessorImageId
    ) {
      console.warn('Found multiple source predecessors, not defaulting to same series');
      return;
    }
    predecessorImageId ||= annotation.predecessorImageId;
  }
  return predecessorImageId;
}

export default promptSaveReport;
