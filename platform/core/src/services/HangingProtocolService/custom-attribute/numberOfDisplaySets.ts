/**
 * Count of display sets in the study (includes SR and other non-image series).
 */
export default (study, extraData) => {
  const displaySets = extraData?.displaySets;

  if (Array.isArray(displaySets) && displaySets.length) {
    return displaySets.filter(ds => !ds?.unsupported).length;
  }

  return Number(study?.NumberOfStudyRelatedSeries) || study?.series?.length || 0;
};
