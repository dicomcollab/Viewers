import { fixBulkDataURI } from './fixBulkDataURI';

function isPrimitive(v: any) {
  // `null` must be treated as primitive; otherwise Object.keys(null) throws
  // "Cannot convert undefined or null to object" during metadata cleanup.
  if (v === null || v === undefined) {
    return true;
  }
  return !(typeof v === 'object' || Array.isArray(v));
}

const vrNumerics = new Set([
  'DS',
  'FL',
  'FD',
  'IS',
  'OD',
  'OF',
  'OL',
  'OV',
  'SL',
  'SS',
  'SV',
  'UL',
  'US',
  'UV',
]);

/**
 * Specialized for DICOM JSON format dataset cleaning.
 * @param obj
 * @returns
 */
export function cleanDenaturalizedDataset(
  obj: any,
  options?: {
    StudyInstanceUID: string;
    SeriesInstanceUID: string;
    dataSourceConfig: unknown;
  }
): any {
  if (Array.isArray(obj)) {
    const newAry = obj.map(o => (isPrimitive(o) ? o : cleanDenaturalizedDataset(o, options)));
    return newAry;
  }
  if (isPrimitive(obj)) {
    return obj;
  }
  Object.keys(obj).forEach(key => {
    const tag = obj[key];
    if (!tag || typeof tag !== 'object') {
      return;
    }
    if (tag.Value === null && tag.vr) {
      delete tag.Value;
    } else if (Array.isArray(tag.Value) && tag.vr) {
      if (tag.Value.length === 1 && tag.Value[0]?.BulkDataURI) {
        if (options?.dataSourceConfig) {
          // Not needed unless data source is directly used for loading data.
          fixBulkDataURI(tag.Value[0], options, options.dataSourceConfig);
        }

        tag.BulkDataURI = tag.Value[0].BulkDataURI;

        // prevent mixed-content blockage
        if (window.location.protocol === 'https:' && tag.BulkDataURI.startsWith('http:')) {
          tag.BulkDataURI = tag.BulkDataURI.replace('http:', 'https:');
        }
        delete tag.Value;
      } else if (vrNumerics.has(tag.vr)) {
        tag.Value = tag.Value.map(v => +v);
      } else {
        tag.Value = tag.Value.map(entry => cleanDenaturalizedDataset(entry, options));
      }
    }
  });
  return obj;
}

/**
 * This is required to make the denaturalized data transferrable when it has
 * added proxy values.
 */
export function transferDenaturalizedDataset(dataset) {
  const noNull = cleanDenaturalizedDataset(dataset);
  return JSON.parse(JSON.stringify(noNull));
}
