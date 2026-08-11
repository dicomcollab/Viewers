/**
 * True when every series/display set in the study is a structured report.
 * Used so SR studies auto-hang in 1×1 (full screen) instead of a multi-up grid.
 */
export default (study, extraData) => {
  const displaySets = extraData?.displaySets || [];

  if (displaySets.length) {
    return displaySets.every(
      ds =>
        ds?.Modality === 'SR' ||
        (typeof ds?.SOPClassHandlerId === 'string' && ds.SOPClassHandlerId.includes('dicom-sr'))
    );
  }

  let mods = study?.ModalitiesInStudy;

  if (!mods?.length && Array.isArray(study?.series)) {
    mods = study.series.map(s => s.Modality).filter(Boolean);
  }

  if (!mods) {
    return false;
  }

  const list = Array.isArray(mods) ? mods : String(mods).split(/\\/);
  const normalized = list.map(m => String(m).trim()).filter(Boolean);

  return normalized.length > 0 && normalized.every(m => m === 'SR');
};
