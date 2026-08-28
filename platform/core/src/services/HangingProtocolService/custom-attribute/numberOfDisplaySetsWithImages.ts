const NON_IMAGE_MODALITIES = new Set([
  'SR',
  'PR',
  'SEG',
  'KO',
  'DOC',
  'SM',
  'RTSTRUCT',
  'RTPLAN',
  'RTDOSE',
  'PMAP',
]);

function isImageDisplaySet(ds) {
  if (!ds || ds.unsupported) {
    return false;
  }
  const frames = ds.numImageFrames ?? ds.instances?.length ?? ds.imageIds?.length ?? 0;
  if (frames <= 0) {
    return false;
  }
  const modality = String(ds.Modality || '').toUpperCase();
  if (NON_IMAGE_MODALITIES.has(modality)) {
    return false;
  }
  const handlerId = ds.SOPClassHandlerId;
  if (typeof handlerId === 'string' && handlerId.includes('dicom-sr')) {
    return false;
  }
  return true;
}

/**
 * Count image series/instances only. SR/PR/SEG must not bump a single US
 * instance into the 1×2 / 2×2 auto-match.
 */
export default (study, extraData) => {
  const displaySets = extraData?.displaySets;
  if (!Array.isArray(displaySets)) {
    return 0;
  }
  return displaySets.filter(isImageDisplaySet).length;
};
