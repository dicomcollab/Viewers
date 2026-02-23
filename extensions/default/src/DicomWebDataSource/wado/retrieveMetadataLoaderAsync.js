import dcmjs from 'dcmjs';
import { sortStudySeries } from '@ohif/core/src/utils/sortStudy';
import RetrieveMetadataLoader from './retrieveMetadataLoader';
import { getCachedSeriesMetadata } from '../utils/seriesMetadataCache.js';

// Series Date, Series Time, Series Description and Series Number to be included
// in the series metadata query result
const includeField = ['00080021', '00080031', '0008103E', '00200011'].join(',');

export class DeferredPromise {
  metadata = undefined;
  processFunction = undefined;
  internalPromise = undefined;
  thenFunction = undefined;
  rejectFunction = undefined;

  setMetadata(metadata) {
    this.metadata = metadata;
  }
  setProcessFunction(func) {
    this.processFunction = func;
  }
  getPromise() {
    return this.start();
  }
  start() {
    if (this.internalPromise) {
      return this.internalPromise;
    }
    this.internalPromise = this.processFunction();
    // in case then and reject functions called before start
    if (this.thenFunction) {
      this.then(this.thenFunction);
      this.thenFunction = undefined;
    }
    if (this.rejectFunction) {
      this.reject(this.rejectFunction);
      this.rejectFunction = undefined;
    }
    return this.internalPromise;
  }
  then(func) {
    if (this.internalPromise) {
      return this.internalPromise.then(func);
    } else {
      this.thenFunction = func;
    }
  }
  reject(func) {
    if (this.internalPromise) {
      return this.internalPromise.reject(func);
    } else {
      this.rejectFunction = func;
    }
  }
}
/**
 * Creates an immutable series loader object which loads each series sequentially using the iterator interface.
 *
 * @param {DICOMWebClient} dicomWebClient The DICOMWebClient instance to be used for series load
 * @param {string} studyInstanceUID The Study Instance UID from which series will be loaded
 * @param {Array} seriesInstanceUIDList A list of Series Instance UIDs
 *
 * @returns {Object} Returns an object which supports loading of instances from each of given Series Instance UID
 */
function makeSeriesAsyncLoader(client, studyInstanceUID, seriesInstanceUIDList, dataSourceName) {
  return Object.freeze({
    hasNext() {
      return seriesInstanceUIDList.length > 0;
    },
    next() {
      const { seriesInstanceUID, metadata } = seriesInstanceUIDList.shift();
      const promise = new DeferredPromise();
      promise.setMetadata(metadata);
      promise.setProcessFunction(() => {
        // Wrap with caching
        const fetchSeriesMetadata = () => {
          return client.retrieveSeriesMetadata({
            studyInstanceUID,
            seriesInstanceUID,
          });
        };

        // Use cached series metadata if available
        return getCachedSeriesMetadata(
          fetchSeriesMetadata,
          dataSourceName || 'default',
          studyInstanceUID,
          seriesInstanceUID
        );
      });
      return promise;
    },
  });
}

/**
 * Class for async load of study metadata.
 * It inherits from RetrieveMetadataLoader
 *
 * It loads the one series and then append to seriesLoader the others to be consumed/loaded
 */
export default class RetrieveMetadataLoaderAsync extends RetrieveMetadataLoader {
  constructor(client, studyInstanceUID, filters = {}, sortCriteria = undefined, sortFunction = undefined, dataSourceName = undefined) {
    super(client, studyInstanceUID, filters, sortCriteria, sortFunction);
    this.dataSourceName = dataSourceName;
  }

  /**
   * @returns {Array} Array of preLoaders. To be consumed as queue
   */
  *getPreLoaders() {
    const preLoaders = [];
    const { studyInstanceUID, filters: { seriesInstanceUID } = {}, client } = this;

    // asking to include Series Date, Series Time, Series Description
    // and Series Number in the series metadata returned to better sort series
    // in preLoad function
    let options = {
      studyInstanceUID,
      queryParams: {
        includefield: includeField,
      },
    };

    if (seriesInstanceUID) {
      options.queryParams.SeriesInstanceUID = seriesInstanceUID;
      preLoaders.push(client.searchForSeries.bind(client, options));
    }
    // Fallback preloader
    preLoaders.push(client.searchForSeries.bind(client, options));

    yield* preLoaders;
  }

  async preLoad() {
    const { studyInstanceUID, dataSourceName, client } = this;

    // Try to get cached raw series data first (for preLoad we need raw data before naturalization)
    const queryClient = typeof window !== 'undefined' && window.__OHIF_QUERY_CLIENT__
      ? window.__OHIF_QUERY_CLIENT__
      : null;

    if (queryClient) {
      // Cache key for raw series data (before processing)
      const queryKey = ['seriesSearchRaw', dataSourceName || 'default', studyInstanceUID];
      const cachedRawData = queryClient.getQueryData(queryKey);

      if (cachedRawData) {
        console.log(`[Series Search Cache] ✅ CACHE HIT in preLoad (raw) - Study: ${studyInstanceUID.substring(0, 20)}...`);
        const sortCriteria = this.sortCriteria;
        const sortFunction = this.sortFunction;
        const { naturalizeDataset } = dcmjs.data.DicomMetaDictionary;
        const naturalized = cachedRawData.map(naturalizeDataset);
        return sortStudySeries(naturalized, sortCriteria, sortFunction);
      }
    }

    // If not cached, proceed with normal loading
    const preLoaders = this.getPreLoaders();
    const result = await this.runLoaders(preLoaders);

    // Cache the raw result for future use
    if (queryClient && result && result.length > 0) {
      const queryKey = ['seriesSearchRaw', dataSourceName || 'default', studyInstanceUID];
      queryClient.setQueryData(queryKey, result, {
        staleTime: 1000, // 1 hour
        gcTime: 1000, // 24 hours
      });
      console.log(`[Series Search Cache] ✅ Cached raw series data for preLoad: ${studyInstanceUID.substring(0, 20)}...`);
    }

    const sortCriteria = this.sortCriteria;
    const sortFunction = this.sortFunction;

    const { naturalizeDataset } = dcmjs.data.DicomMetaDictionary;
    const naturalized = result.map(naturalizeDataset);

    return sortStudySeries(naturalized, sortCriteria, sortFunction);
  }

  async load(preLoadData) {
    const { client, studyInstanceUID, dataSourceName } = this;

    const seriesInstanceUIDs = preLoadData.map(seriesMetadata => {
      return { seriesInstanceUID: seriesMetadata.SeriesInstanceUID, metadata: seriesMetadata };
    });

    const seriesAsyncLoader = makeSeriesAsyncLoader(client, studyInstanceUID, seriesInstanceUIDs, dataSourceName);

    const promises = [];

    while (seriesAsyncLoader.hasNext()) {
      const promise = seriesAsyncLoader.next();
      promises.push(promise);
    }

    return {
      preLoadData,
      promises,
    };
  }

  async posLoad({ preLoadData, promises }) {
    return {
      preLoadData,
      promises,
    };
  }
}
