import { DicomMetadataStore } from '@ohif/core';
import {
  isStructuredReportDisplaySet,
  isStructuredReportSopClassUID,
} from './openStructuredReportInViewport';

/**
 * Reload series metadata and return a supported SR display set (fixes series that were
 * cached as "unsupported" before dicom-sr handlers were registered).
 */
export async function ensureStructuredReportDisplaySet(
  displaySet,
  { dataSource, displaySetService }
) {
  if (!displaySet) {
    return null;
  }

  if (!displaySet.unsupported && isStructuredReportDisplaySet(displaySet)) {
    return displaySet;
  }

  const { StudyInstanceUID, SeriesInstanceUID, SOPClassUID } = displaySet;
  const mayBeSr =
    displaySet.Modality === 'SR' ||
    displaySet.Modality === 'OT' ||
    isStructuredReportSopClassUID(SOPClassUID) ||
    /structured report|dose report|sr\b/i.test(displaySet.SeriesDescription || '');

  if (!mayBeSr || !StudyInstanceUID || !SeriesInstanceUID) {
    return displaySet;
  }

  if (dataSource?.retrieve?.series?.metadata) {
    try {
      await dataSource.retrieve.series.metadata({
        StudyInstanceUID,
        filters: { seriesInstanceUID: SeriesInstanceUID },
        madeInClient: true,
      });
    } catch (error) {
      console.warn('[SR] Failed to reload series metadata', error);
    }
  }

  const refreshed =
    displaySetService
      .getActiveDisplaySets()
      .find(
        ds =>
          ds.SeriesInstanceUID === SeriesInstanceUID &&
          !ds.unsupported &&
          isStructuredReportDisplaySet(ds)
      ) || null;

  if (refreshed) {
    return refreshed;
  }

  const series = DicomMetadataStore.getSeries(StudyInstanceUID, SeriesInstanceUID);
  if (series?.instances?.length) {
    displaySetService.makeDisplaySets(series.instances, { madeInClient: true });
    return (
      displaySetService
        .getActiveDisplaySets()
        .find(
          ds =>
            ds.SeriesInstanceUID === SeriesInstanceUID &&
            !ds.unsupported &&
            isStructuredReportDisplaySet(ds)
        ) || displaySet
    );
  }

  return displaySet;
}
