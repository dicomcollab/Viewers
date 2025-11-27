/**
 * Utility to get the global QueryClient instance
 * This allows us to use React Query caching from extension code
 * @returns {import('@tanstack/react-query').QueryClient | null}
 */
function getQueryClient() {
  // @ts-ignore - window.__OHIF_QUERY_CLIENT__ is set globally
  if (typeof window !== 'undefined' && window.__OHIF_QUERY_CLIENT__) {
    // @ts-ignore - window.__OHIF_QUERY_CLIENT__ is set globally
    return window.__OHIF_QUERY_CLIENT__;
  }
  return null;
}

/**
 * Creates a unique query key for study metadata caching
 * @param {string} dataSourceName - Name of the data source
 * @param {string} StudyInstanceUID - Study Instance UID
 * @param {Object} filters - Optional filters
 * @param {boolean} enableStudyLazyLoad - Whether lazy load is enabled
 * @returns {Array} Query key array for React Query
 */
export function createStudyMetadataQueryKey(dataSourceName, StudyInstanceUID, filters, enableStudyLazyLoad) {
  const baseKey = ['studyMetadata', dataSourceName, StudyInstanceUID];

  // Include filters in the key to ensure different filters create different cache entries
  if (filters && filters.seriesInstanceUID) {
    const seriesFilter = Array.isArray(filters.seriesInstanceUID)
      ? filters.seriesInstanceUID.sort().join(',')
      : filters.seriesInstanceUID;
    baseKey.push(`series:${seriesFilter}`);
  }

  // Include lazy load setting in key
  baseKey.push(`lazyLoad:${enableStudyLazyLoad}`);

  return baseKey;
}

/**
 * Retrieves study metadata using React Query cache
 * Falls back to direct promise if React Query is not available
 *
 * @param {Function} fetchFn - Function that fetches the metadata
 * @param {string} dataSourceName - Name of the data source
 * @param {string} StudyInstanceUID - Study Instance UID
 * @param {Object} filters - Optional filters
 * @param {boolean} enableStudyLazyLoad - Whether lazy load is enabled
 * @returns {Promise} Promise that resolves with the metadata
 */
export async function getCachedStudyMetadata(
  fetchFn,
  dataSourceName,
  StudyInstanceUID,
  filters,
  enableStudyLazyLoad
) {
  // IMPORTANT: Don't cache async lazy load mode because it returns {preLoadData, promises}
  // and promises contain functions that can't be serialized to localStorage.
  // Caching async mode causes infinite loops because the promises structure is lost.
  if (enableStudyLazyLoad) {
    return fetchFn();
  }

  const queryClient = getQueryClient();

  // If React Query is not available, fall back to direct fetch
  if (!queryClient) {
    return fetchFn();
  }

  const queryKey = createStudyMetadataQueryKey(
    dataSourceName,
    StudyInstanceUID,
    filters,
    enableStudyLazyLoad
  );

  try {
    // Check if we have cached data first
    const cachedData = queryClient.getQueryData(queryKey);
    if (cachedData) {
      // For sync mode, cached data should be an array of instances
      // Return it directly - the calling code expects an array
      return cachedData;
    }

    // Use fetchQuery which will return cached data if available, or fetch new data
    const data = await queryClient.fetchQuery({
      queryKey,
      queryFn: async () => {
        return await fetchFn();
      },
      staleTime: 60 * 60 * 1000, // 1 hour - consider data fresh for 1 hour
      gcTime: 60 * 60 * 1000, // 1 hour - keep in cache for 1 hour
    });

    return data;
  } catch (error) {
    // If there's an error with React Query, fall back to direct fetch
    return fetchFn();
  }
}

/**
 * Invalidates cached study metadata for a specific study
 * @param {string} dataSourceName - Name of the data source
 * @param {string} StudyInstanceUID - Study Instance UID
 */
export function invalidateStudyMetadataCache(dataSourceName, StudyInstanceUID) {
  const queryClient = getQueryClient();

  if (!queryClient) {
    return;
  }

  // Invalidate all queries that start with this study's metadata
  queryClient.invalidateQueries({
    queryKey: ['studyMetadata', dataSourceName, StudyInstanceUID],
  });
}

/**
 * Get cache statistics for debugging
 * @returns {Object} Cache statistics
 */
export function getCacheStats() {
  const queryClient = getQueryClient();

  if (!queryClient) {
    return { available: false };
  }

  const queryCache = queryClient.getQueryCache();
  const allQueries = queryCache.getAll();
  const studyMetadataQueries = allQueries.filter(q =>
    Array.isArray(q.queryKey) && q.queryKey[0] === 'studyMetadata'
  );

  return {
    available: true,
    totalQueries: allQueries.length,
    studyMetadataQueries: studyMetadataQueries.length,
    cachedStudies: studyMetadataQueries.map(q => ({
      key: q.queryKey,
      hasData: q.state.data !== undefined,
      dataUpdatedAt: q.state.dataUpdatedAt,
      age: q.state.dataUpdatedAt ? Date.now() - q.state.dataUpdatedAt : null,
    })),
  };
}
