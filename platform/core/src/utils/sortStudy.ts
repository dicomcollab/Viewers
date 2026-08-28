import { vec3 } from 'gl-matrix';
import isLowPriorityModality from './isLowPriorityModality';
import calculateScanAxisNormal from './calculateScanAxisNormal';
import areAllImageOrientationsEqual from './areAllImageOrientationsEqual';

const compareSeriesDateTime = (a, b) => {
  const seriesDateA = Date.parse(`${a.seriesDate ?? a.SeriesDate} ${a.seriesTime ?? a.SeriesTime}`);
  const seriesDateB = Date.parse(`${b.seriesDate ?? b.SeriesDate} ${b.seriesTime ?? b.SeriesTime}`);
  return seriesDateA - seriesDateB;
};

const defaultSeriesSort = (a, b) => {
  const seriesNumberA = a.SeriesNumber ?? a.seriesNumber;
  const seriesNumberB = b.SeriesNumber ?? b.seriesNumber;
  if (seriesNumberA === seriesNumberB) {
    return compareSeriesDateTime(a, b);
  }
  return seriesNumberA - seriesNumberB;
};

/**
 * Series sorting criteria: series considered low priority are moved to the end
 * of the list and series number is used to break ties
 * @param {Object} firstSeries
 * @param {Object} secondSeries
 */
function seriesInfoSortingCriteria(firstSeries, secondSeries) {
  const aLowPriority = isLowPriorityModality(firstSeries.Modality ?? firstSeries.modality);
  const bLowPriority = isLowPriorityModality(secondSeries.Modality ?? secondSeries.modality);

  if (aLowPriority) {
    // Use the reverse sort order for low priority modalities so that the
    // most recent one comes up first as usually that is the one of interest.
    return bLowPriority ? defaultSeriesSort(secondSeries, firstSeries) : 1;
  } else if (bLowPriority) {
    return -1;
  }

  return defaultSeriesSort(firstSeries, secondSeries);
}

const seriesSortCriteria = {
  default: seriesInfoSortingCriteria,
  seriesInfoSortingCriteria,
};

const sortByInstanceNumber = (a, b) => {
  // Prefer series number when sorting study-panel display-set thumbnails.
  const aSeries = Number(a.SeriesNumber ?? a.seriesNumber ?? 0);
  const bSeries = Number(b.SeriesNumber ?? b.seriesNumber ?? 0);
  if (aSeries !== bSeries) {
    return aSeries - bSeries;
  }

  // Sort by InstanceNumber (0020,0013) — also accepts mapped thumbnail `instanceNumber`.
  const aInstance = parseInt(a.InstanceNumber ?? a.instanceNumber, 10) || 0;
  const bInstance = parseInt(b.InstanceNumber ?? b.instanceNumber, 10) || 0;
  if (aInstance !== bInstance) {
    return aInstance - bInstance;
  }
  // Fallback rule to enable consistent sorting
  const aUid = a.SOPInstanceUID ?? a.displaySetInstanceUID;
  const bUid = b.SOPInstanceUID ?? b.displaySetInstanceUID;
  if (aUid === bUid) {
    return 0;
  }
  return aUid < bUid ? -1 : 1;
};

const instancesSortCriteria = {
  default: sortByInstanceNumber,
  sortByInstanceNumber,
};

const sortingCriteria = {
  seriesSortCriteria,
  instancesSortCriteria,
};

/**
 * Sorts given series (given param is modified)
 * The default criteria is based on series number in ascending order.
 *
 * @param {Array} series List of series
 * @param {function} seriesSortingCriteria method for sorting
 * @returns {Array} sorted series object
 */
const sortStudySeries = (
  series,
  seriesSortingCriteria = seriesSortCriteria.default,
  sortFunction = null
) => {
  if (typeof sortFunction === 'function') {
    return sortFunction(series);
  } else {
    return series.sort(seriesSortingCriteria);
  }
};

/**
 * Sorts given instancesList (given param is modified)
 * The default criteria is based on instance number in ascending order.
 *
 * @param {Array} instancesList List of series
 * @param {function} instancesSortingCriteria method for sorting
 * @returns {Array} sorted instancesList object
 */
const sortStudyInstances = (
  instancesList,
  instancesSortingCriteria = instancesSortCriteria.default
) => {
  return instancesList.sort(instancesSortingCriteria);
};

/**
 * Sorts the series and instances (by default) inside a study instance based on sortingCriteria (given param is modified)
 * The default criteria is based on series and instance numbers in ascending order.
 *
 * @param {Object} study The study instance
 * @param {boolean} [deepSort = true] to sort instance also
 * @param {function} [seriesSortingCriteria = seriesSortCriteria.default] method for sorting series
 * @param {function} [instancesSortingCriteria = instancesSortCriteria.default] method for sorting instances
 * @returns {Object} sorted study object
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
      sortStudyInstances(series.instances, instancesSortingCriteria);
    });
  }

  return study;
}

function isValidForPositionSort(images): boolean {
  if (images.length <= 1) {
    return false; // No need to sort if there's only one image
  }

  // Use the first image as a reference
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
 * Sort by image position, calculated using imageOrientationPatient and ImagePositionPatient
 * If imageOrientationPatient or ImagePositionPatient is not available, Images will be sorted by the provided sortingCriteria
 * Note: Images are sorted in-place and a reference to the sorted image array is returned.
 *
 * @returns images - reference to images after sorting
 */
const sortImagesByPatientPosition = images => {
  const referenceImagePositionPatient = images[0].ImagePositionPatient;
  const imageOrientationPatient = images[0].ImageOrientationPatient;

  // Calculate the scan axis normal using the cross product
  const scanAxisNormal = calculateScanAxisNormal(imageOrientationPatient);

  // Compute distances from each image to the reference image
  const distanceInstancePairs = images.map(image => {
    const imagePositionPatient = image.ImagePositionPatient;
    const deltaVector = vec3.create();
    const distance = vec3.dot(
      scanAxisNormal,
      vec3.subtract(deltaVector, imagePositionPatient, referenceImagePositionPatient)
    );
    return { distance, image };
  });
  // Candidate orders by patient position (both directions are valid geometrically).
  const descendingByDistance = [...distanceInstancePairs].sort((a, b) => b.distance - a.distance);
  const ascendingByDistance = [...descendingByDistance].reverse();

  // If InstanceNumber is available, pick direction that keeps it increasing.
  // This prevents reversed stack navigation when server ordering and spatial
  // direction are opposite.
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

  // Reorder the images in the original array
  for (const [index, item] of chosenOrder.entries()) {
    images[index] = item.image;
  }

  return images;
};

export {
  sortStudy,
  sortStudySeries,
  sortStudyInstances,
  sortingCriteria,
  seriesSortCriteria,
  instancesSortCriteria,
  isValidForPositionSort,
  sortImagesByPatientPosition,
};
