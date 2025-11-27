import retrieveMetadataFiltered from './utils/retrieveMetadataFiltered.js';
import RetrieveMetadata from './wado/retrieveMetadata.js';
import { getCachedStudyMetadata } from './utils/studyMetadataCache.js';

const moduleName = 'RetrieveStudyMetadata';
// Cache for promises. Prevents unnecessary subsequent calls to the server
// This is kept as a fallback and for in-flight request deduplication
const StudyMetaDataPromises = new Map();

/**
 * Retrieves study metadata with React Query caching support.
 * Uses React Query for persistent caching across page loads and navigation.
 *
 * @param {Object} dicomWebClient The DICOMWebClient instance to be used for series load
 * @param {string} StudyInstanceUID The UID of the Study to be retrieved
 * @param {boolean} enableStudyLazyLoad Whether the study metadata should be loaded asynchronously.
 * @param {Object} [filters] Object containing filters to be applied on retrieve metadata process
 * @param {string} [filters.seriesInstanceUID] Series instance uid to filter results against
 * @param {function} [sortCriteria] Sort criteria function
 * @param {function} [sortFunction] Sort function
 * @param {Object} [dicomWebConfig] DICOM Web configuration object
 *
 * @returns {Promise} that will be resolved with the metadata or rejected with the error
 */
export function retrieveStudyMetadata(
  dicomWebClient,
  StudyInstanceUID,
  enableStudyLazyLoad,
  filters,
  sortCriteria,
  sortFunction,
  dicomWebConfig = {}
) {
  if (!dicomWebClient) {
    throw new Error(`${moduleName}: Required 'dicomWebClient' parameter not provided.`);
  }
  if (!StudyInstanceUID) {
    throw new Error(`${moduleName}: Required 'StudyInstanceUID' parameter not provided.`);
  }

  const promiseId = `${dicomWebConfig.name}:${StudyInstanceUID}`;

  // Create the fetch function that will be used by React Query or as fallback
  const fetchMetadata = () => {
    // Check if we already have an in-flight request for this exact query
    // This prevents duplicate requests for the same study while one is loading
    if (StudyMetaDataPromises.has(promiseId)) {
      return StudyMetaDataPromises.get(promiseId);
    }

    let promise;

    if (filters && filters.seriesInstanceUID && Array.isArray(filters.seriesInstanceUID)) {
      promise = retrieveMetadataFiltered(
        dicomWebClient,
        StudyInstanceUID,
        enableStudyLazyLoad,
        filters,
        sortCriteria,
        sortFunction,
        dicomWebConfig.name || 'default'
      );
    } else {
      // Create a promise to handle the data retrieval
      promise = new Promise((resolve, reject) => {
        RetrieveMetadata(
          dicomWebClient,
          StudyInstanceUID,
          enableStudyLazyLoad,
          filters,
          sortCriteria,
          sortFunction,
          dicomWebConfig.name || 'default'
        ).then(function (data) {
          resolve(data);
        }, reject);
      });
    }

    // Store the promise in cache for in-flight request deduplication
    StudyMetaDataPromises.set(promiseId, promise);

    // Clean up the promise from cache once it resolves or rejects
    promise
      .then(() => {
        // Keep promise in cache for a short time to handle rapid re-requests
        setTimeout(() => {
          StudyMetaDataPromises.delete(promiseId);
        }, 1000);
      })
      .catch(() => {
        // Remove failed promises immediately so they can be retried
        StudyMetaDataPromises.delete(promiseId);
      });

    return promise;
  };

  // Use React Query cache if available, otherwise fall back to direct fetch
  return getCachedStudyMetadata(
    fetchMetadata,
    dicomWebConfig.name || 'default',
    StudyInstanceUID,
    filters,
    enableStudyLazyLoad
  );
}

/**
 * Delete the cached study metadata retrieval promise to ensure that the browser will
 * re-retrieve the study metadata when it is next requested.
 *
 * @param {String} StudyInstanceUID The UID of the Study to be removed from cache
 * @param {String} [dataSourceName] Optional data source name for React Query cache invalidation
 */
export function deleteStudyMetadataPromise(StudyInstanceUID, dataSourceName) {
  const promiseId = dataSourceName ? `${dataSourceName}:${StudyInstanceUID}` : StudyInstanceUID;

  // Remove from in-flight promises cache
  if (StudyMetaDataPromises.has(promiseId)) {
    StudyMetaDataPromises.delete(promiseId);
  }

  // Invalidate React Query cache if available
  if (typeof window !== 'undefined' && window.__OHIF_QUERY_CLIENT__) {
    const { invalidateStudyMetadataCache } = require('./utils/studyMetadataCache.js');
    invalidateStudyMetadataCache(dataSourceName || 'default', StudyInstanceUID);
  }
}
