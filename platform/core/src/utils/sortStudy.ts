import { vec3 } from 'gl-matrix';
import calculateScanAxisNormal from './calculateScanAxisNormal';
import areAllImageOrientationsEqual from './areAllImageOrientationsEqual';

/**
 * DICOM-standard chronological ordering for Study Panel, metadata load,
 * hanging-protocol fill, and viewport / next-previous navigation.
 *
 * Series order:
 *   1. AcquisitionDateTime (0008,002A)
 *   2. SeriesDate (0008,0021) + SeriesTime (0008,0031)
 *   3. SeriesNumber (0020,0011)
 *   4. SeriesInstanceUID (0020,000E)
 *
 * Instance order (within a series; multi-frame frames stay native order):
 *   1. AcquisitionDateTime (0008,002A)
 *   2. AcquisitionNumber (0020,0012)
 *   3. InstanceNumber (0020,0013)
 *   4. SOPInstanceUID (0008,0018)
 */

const DICOM_SORT_DEBUG = typeof process !== 'undefined' && process.env?.NODE_ENV !== 'production';
const dicomSortDebugKeys = new Set<string>();

function asTrimmedString(value): string {
  if (value == null) {
    return '';
  }
  const text = String(value).trim();
  if (!text || text.toLowerCase() === 'undefined' || text.toLowerCase() === 'null') {
    return '';
  }
  return text;
}

/** Normalize DICOM DA+TM / DT strings for lexicographic ascending compare. */
function normalizeDicomDateTime(dateOrDateTime, time = ''): string {
  const rawDateTime = asTrimmedString(dateOrDateTime);
  if (!rawDateTime) {
    return '';
  }

  // Already a DT (YYYYMMDDHHMMSS[.ffffff][+/-HHMM])
  if (/^\d{8,}/.test(rawDateTime) && rawDateTime.length > 8 && !asTrimmedString(time)) {
    return rawDateTime.replace(/[^0-9.]/g, '');
  }

  const datePart = rawDateTime.replace(/[^0-9]/g, '').slice(0, 8);
  if (datePart.length !== 8) {
    return '';
  }

  const timePart = asTrimmedString(time)
    .replace(/[^0-9.]/g, '')
    .slice(0, 13);
  return `${datePart}${timePart}`;
}

function getFirstInstance(item) {
  return item?.instance ?? item?.instances?.[0] ?? item?.images?.[0] ?? null;
}

function getAcquisitionDateTimeValue(item): string {
  const instance = getFirstInstance(item);
  return (
    normalizeDicomDateTime(
      item?.AcquisitionDateTime ??
        item?.acquisitionDatetime ??
        item?.acquisitionDateTime ??
        instance?.AcquisitionDateTime ??
        instance?.acquisitionDatetime
    ) ||
    normalizeDicomDateTime(
      item?.AcquisitionDate ?? instance?.AcquisitionDate,
      item?.AcquisitionTime ?? instance?.AcquisitionTime
    ) ||
    // US and some modalities populate ContentDate/Time when AcquisitionDateTime is absent
    normalizeDicomDateTime(
      item?.ContentDateTime ?? instance?.ContentDateTime ?? item?.contentDateTime
    ) ||
    normalizeDicomDateTime(
      item?.ContentDate ?? instance?.ContentDate,
      item?.ContentTime ?? instance?.ContentTime
    )
  );
}

function getSeriesDateTimeValue(item): string {
  const instance = getFirstInstance(item);
  return normalizeDicomDateTime(
    item?.SeriesDate ?? item?.seriesDate ?? instance?.SeriesDate,
    item?.SeriesTime ?? item?.seriesTime ?? instance?.SeriesTime
  );
}

/** @deprecated use getSeriesDateTimeValue — kept for callers expecting a stamp string */
function getSeriesDateTimeStamp(item): string {
  return getSeriesDateTimeValue(item) || getAcquisitionDateTimeValue(item);
}

function getSeriesNumberValue(item): number | null {
  const raw = item?.SeriesNumber ?? item?.seriesNumber;
  if (raw == null || raw === '') {
    return null;
  }
  const value = Number.parseInt(String(raw), 10);
  return Number.isFinite(value) ? value : null;
}

function getAcquisitionNumberValue(item): number | null {
  const instance = getFirstInstance(item);
  const raw = item?.AcquisitionNumber ?? item?.acquisitionNumber ?? instance?.AcquisitionNumber;
  if (raw == null || raw === '') {
    return null;
  }
  const value = Number.parseInt(String(raw), 10);
  return Number.isFinite(value) ? value : null;
}

function getInstanceNumberValue(item): number | null {
  const instance = getFirstInstance(item);
  const raw =
    item?.InstanceNumber ??
    item?.instanceNumber ??
    instance?.InstanceNumber ??
    instance?.instanceNumber;
  if (raw == null || raw === '') {
    return null;
  }
  const value = Number.parseInt(String(raw), 10);
  return Number.isFinite(value) ? value : null;
}

function getSeriesInstanceUIDValue(item): string {
  return asTrimmedString(
    item?.SeriesInstanceUID ?? item?.seriesInstanceUID ?? getFirstInstance(item)?.SeriesInstanceUID
  );
}

function getSopInstanceUIDValue(item): string {
  return asTrimmedString(
    item?.SOPInstanceUID ??
      item?.sopInstanceUID ??
      getFirstInstance(item)?.SOPInstanceUID ??
      getFirstInstance(item)?.sopInstanceUID
  );
}

function compareOptionalString(a: string, b: string): number | null {
  if (!a && !b) {
    return null;
  }
  if (!a) {
    return 1;
  }
  if (!b) {
    return -1;
  }
  if (a === b) {
    return null;
  }
  return a.localeCompare(b);
}

function compareOptionalNumber(a: number | null, b: number | null): number | null {
  if (a == null && b == null) {
    return null;
  }
  if (a == null) {
    return 1;
  }
  if (b == null) {
    return -1;
  }
  if (a === b) {
    return null;
  }
  return a - b;
}

/**
 * Series-level DICOM chronological compare for real Series objects (QIDO / study.series).
 * Final fallback: SeriesInstanceUID only (never parse UID for time).
 */
function compareSeriesByDicomOrder(a, b): number {
  if (!a && !b) {
    return 0;
  }
  if (!a) {
    return 1;
  }
  if (!b) {
    return -1;
  }

  const byAcq = compareOptionalString(getAcquisitionDateTimeValue(a), getAcquisitionDateTimeValue(b));
  if (byAcq != null) {
    return byAcq;
  }

  const bySeriesDate = compareOptionalString(getSeriesDateTimeValue(a), getSeriesDateTimeValue(b));
  if (bySeriesDate != null) {
    return bySeriesDate;
  }

  const bySeriesNumber = compareOptionalNumber(getSeriesNumberValue(a), getSeriesNumberValue(b));
  if (bySeriesNumber != null) {
    return bySeriesNumber;
  }

  const bySeriesUid = compareOptionalString(getSeriesInstanceUIDValue(a), getSeriesInstanceUIDValue(b));
  if (bySeriesUid != null) {
    return bySeriesUid;
  }

  return 0;
}

/**
 * Discriminate display sets that belong to different series.
 * Returns null when both belong to the same series (or series keys cannot decide),
 * so callers can apply instance-level order (critical for US: many SOPs, one SeriesNumber).
 */
function compareDisplaySetSeriesKeys(a, b): number | null {
  const byAcq = compareOptionalString(getAcquisitionDateTimeValue(a), getAcquisitionDateTimeValue(b));
  // Only treat AcquisitionDateTime as a *series* discriminator when SeriesInstanceUIDs differ.
  // For US one-SOP-per-displaySet in the same series, AcqDT belongs in instance order below.
  const seriesUidA = getSeriesInstanceUIDValue(a);
  const seriesUidB = getSeriesInstanceUIDValue(b);
  const differentSeries = Boolean(seriesUidA && seriesUidB && seriesUidA !== seriesUidB);

  if (differentSeries) {
    if (byAcq != null) {
      return byAcq;
    }

    const bySeriesDate = compareOptionalString(getSeriesDateTimeValue(a), getSeriesDateTimeValue(b));
    if (bySeriesDate != null) {
      return bySeriesDate;
    }

    const bySeriesNumber = compareOptionalNumber(getSeriesNumberValue(a), getSeriesNumberValue(b));
    if (bySeriesNumber != null) {
      return bySeriesNumber;
    }

    return seriesUidA.localeCompare(seriesUidB);
  }

  // Same series (typical US): do not sort by series-level AcqDT/UID here — use instance keys.
  return null;
}

/**
 * Instance-level DICOM chronological compare.
 * Does not split multi-frame objects into frames — caller sorts instances only.
 */
function compareInstancesByDicomOrder(a, b): number {
  if (!a && !b) {
    return 0;
  }
  if (!a) {
    return 1;
  }
  if (!b) {
    return -1;
  }

  const byAcq = compareOptionalString(getAcquisitionDateTimeValue(a), getAcquisitionDateTimeValue(b));
  if (byAcq != null) {
    return byAcq;
  }

  const byAcqNumber = compareOptionalNumber(
    getAcquisitionNumberValue(a),
    getAcquisitionNumberValue(b)
  );
  if (byAcqNumber != null) {
    return byAcqNumber;
  }

  const byInstanceNumber = compareOptionalNumber(
    getInstanceNumberValue(a),
    getInstanceNumberValue(b)
  );
  if (byInstanceNumber != null) {
    return byInstanceNumber;
  }

  const bySop = compareOptionalString(getSopInstanceUIDValue(a), getSopInstanceUIDValue(b));
  if (bySop != null) {
    return bySop;
  }

  return 0;
}

/**
 * Shared display-set / thumbnail / US paging / HP order.
 * Different series → series DICOM chronology.
 * Same series (US per-SOP thumbnails) → instance DICOM chronology (InstanceNumber, etc.).
 */
function compareDisplaySetsByReviewOrder(a, b): number {
  if (!a && !b) {
    return 0;
  }
  if (!a) {
    return 1;
  }
  if (!b) {
    return -1;
  }

  const seriesDiff = compareDisplaySetSeriesKeys(a, b);
  if (seriesDiff != null) {
    return seriesDiff;
  }

  const instanceDiff = compareInstancesByDicomOrder(a, b);
  if (instanceDiff) {
    return instanceDiff;
  }

  return String(a.displaySetInstanceUID ?? a.uid ?? '').localeCompare(
    String(b.displaySetInstanceUID ?? b.uid ?? '')
  );
}

function seriesInfoSortingCriteria(firstSeries, secondSeries) {
  return compareSeriesByDicomOrder(firstSeries, secondSeries);
}

const seriesSortCriteria = {
  default: seriesInfoSortingCriteria,
  seriesInfoSortingCriteria,
};

const sortByInstanceNumber = (a, b) => compareInstancesByDicomOrder(a, b);

const instancesSortCriteria = {
  default: sortByInstanceNumber,
  sortByInstanceNumber,
  compareInstancesByDicomOrder,
};

const sortingCriteria = {
  seriesSortCriteria,
  instancesSortCriteria,
};

function describeSortItem(item, index: number) {
  const instance = getFirstInstance(item);
  return {
    index,
    SeriesDescription:
      item?.SeriesDescription ?? item?.seriesDescription ?? item?.description ?? '',
    SeriesNumber: item?.SeriesNumber ?? item?.seriesNumber ?? null,
    SeriesDate: item?.SeriesDate ?? item?.seriesDate ?? null,
    SeriesTime: item?.SeriesTime ?? item?.seriesTime ?? null,
    AcquisitionDateTime:
      item?.AcquisitionDateTime ??
      item?.acquisitionDatetime ??
      instance?.AcquisitionDateTime ??
      null,
    AcquisitionNumber: item?.AcquisitionNumber ?? instance?.AcquisitionNumber ?? null,
    InstanceNumber:
      item?.InstanceNumber ?? item?.instanceNumber ?? instance?.InstanceNumber ?? null,
    SeriesInstanceUID: getSeriesInstanceUIDValue(item) || null,
    SOPInstanceUID: getSopInstanceUIDValue(item) || null,
    Modality: item?.Modality ?? item?.modality ?? null,
  };
}

/**
 * Debug: log final sorted order once per unique key (dev builds).
 * Filter console by `[DicomSort]`.
 */
function logDicomSortOrder(label: string, items: unknown[], dedupeKey?: string) {
  if (!DICOM_SORT_DEBUG || typeof console === 'undefined' || !items?.length) {
    return;
  }
  const key =
    dedupeKey ||
    `${label}:${items
      .map(
        (item: any) =>
          getSeriesInstanceUIDValue(item) ||
          getSopInstanceUIDValue(item) ||
          item?.displaySetInstanceUID ||
          ''
      )
      .join('|')}`;
  if (dicomSortDebugKeys.has(key)) {
    return;
  }
  dicomSortDebugKeys.add(key);

  // eslint-disable-next-line no-console
  console.info(
    `[DicomSort] ${label}`,
    items.map((item, index) => describeSortItem(item, index))
  );
}

/**
 * Sorts given series (given param is modified)
 * Default: DICOM chronological series order.
 */
const sortStudySeries = (
  series,
  seriesSortingCriteria = seriesSortCriteria.default,
  sortFunction = null
) => {
  if (typeof sortFunction === 'function') {
    const sorted = sortFunction(series);
    logDicomSortOrder('series (custom)', sorted || series);
    return sorted;
  }
  const sorted = series.sort(seriesSortingCriteria);
  logDicomSortOrder('series', sorted);
  return sorted;
};

/**
 * Sorts given instancesList (given param is modified).
 * Multi-frame: each element is one SOP instance; frames stay in native order.
 */
const sortStudyInstances = (
  instancesList,
  instancesSortingCriteria = instancesSortCriteria.default
) => {
  const sorted = instancesList.sort(instancesSortingCriteria);
  logDicomSortOrder('instances', sorted);
  return sorted;
};

/**
 * Sorts the series and instances inside a study (param modified).
 */
export default function sortStudy(
  study,
  deepSort = true,
  seriesSortingCriteria = seriesSortCriteria.default,
  instancesSortingCriteria = instancesSortCriteria.default
) {
  if (!study || !study.series) {
    throw new Error('Insufficient study data was provided to sortStudy');
  }

  sortStudySeries(study.series, seriesSortingCriteria);

  if (deepSort) {
    study.series.forEach(series => {
      if (series?.instances?.length) {
        sortStudyInstances(series.instances, instancesSortingCriteria);
      }
    });
  }

  return study;
}

function isValidForPositionSort(images): boolean {
  if (images.length <= 1) {
    return false;
  }

  const referenceImagePositionPatient = images[0].ImagePositionPatient;
  const imageOrientationPatient = images[0].ImageOrientationPatient;

  if (!referenceImagePositionPatient || !imageOrientationPatient) {
    return false;
  }

  if (!areAllImageOrientationsEqual(images)) {
    return false;
  }

  return true;
}

/**
 * Sort by image position (reconstructable volumes).
 * Used only when spatial geometry is valid; otherwise callers use DICOM instance order.
 */
const sortImagesByPatientPosition = images => {
  const referenceImagePositionPatient = images[0].ImagePositionPatient;
  const imageOrientationPatient = images[0].ImageOrientationPatient;

  const scanAxisNormal = calculateScanAxisNormal(imageOrientationPatient);

  const distanceInstancePairs = images.map(image => {
    const imagePositionPatient = image.ImagePositionPatient;
    const deltaVector = vec3.create();
    const distance = vec3.dot(
      scanAxisNormal,
      vec3.subtract(deltaVector, imagePositionPatient, referenceImagePositionPatient)
    );
    return { distance, image };
  });
  const descendingByDistance = [...distanceInstancePairs].sort((a, b) => b.distance - a.distance);
  const ascendingByDistance = [...descendingByDistance].reverse();

  const getInstanceNumber = image => {
    const value = parseInt(image?.InstanceNumber, 10);
    return Number.isFinite(value) ? value : null;
  };

  const firstAscendingInstanceNumber = getInstanceNumber(ascendingByDistance[0]?.image);
  const lastAscendingInstanceNumber = getInstanceNumber(
    ascendingByDistance[ascendingByDistance.length - 1]?.image
  );
  const firstDescendingInstanceNumber = getInstanceNumber(descendingByDistance[0]?.image);
  const lastDescendingInstanceNumber = getInstanceNumber(
    descendingByDistance[descendingByDistance.length - 1]?.image
  );

  const hasAscendingInstanceRange =
    firstAscendingInstanceNumber !== null &&
    lastAscendingInstanceNumber !== null &&
    firstAscendingInstanceNumber <= lastAscendingInstanceNumber;
  const hasDescendingInstanceRange =
    firstDescendingInstanceNumber !== null &&
    lastDescendingInstanceNumber !== null &&
    firstDescendingInstanceNumber <= lastDescendingInstanceNumber;

  const chosenOrder =
    hasAscendingInstanceRange && !hasDescendingInstanceRange
      ? ascendingByDistance
      : hasDescendingInstanceRange && !hasAscendingInstanceRange
        ? descendingByDistance
        : descendingByDistance;

  for (const [index, item] of chosenOrder.entries()) {
    images[index] = item.image;
  }

  return images;
};

/** @deprecated modality rank is no longer used for review order */
function getModalityReviewRank(modality): number {
  return 0;
}

export {
  compareDisplaySetsByReviewOrder,
  compareSeriesByDicomOrder,
  compareInstancesByDicomOrder,
  getAcquisitionDateTimeValue,
  getSeriesDateTimeStamp,
  getSeriesDateTimeValue,
  getSeriesInstanceUIDValue,
  getSopInstanceUIDValue,
  getSeriesNumberValue,
  getInstanceNumberValue,
  getModalityReviewRank,
  logDicomSortOrder,
  sortStudy,
  sortStudySeries,
  sortStudyInstances,
  sortingCriteria,
  seriesSortCriteria,
  instancesSortCriteria,
  isValidForPositionSort,
  sortImagesByPatientPosition,
};
