/**
 * Utility to get the global QueryClient instance
 */
function getQueryClient() {
  if (typeof window !== 'undefined' && window.__OHIF_QUERY_CLIENT__) {
    return window.__OHIF_QUERY_CLIENT__;
  }
  return null;
}

/**
 * Creates a unique query key for series metadata caching
 * @param {string} dataSourceName - Name of the data source
 * @param {string} StudyInstanceUID - Study Instance UID
 * @param {string} SeriesInstanceUID - Series Instance UID
 * @returns {Array} Query key array for React Query
 */
export function createSeriesMetadataQueryKey(dataSourceName, StudyInstanceUID, SeriesInstanceUID) {
  return ['seriesMetadata', dataSourceName, StudyInstanceUID, SeriesInstanceUID];
}

/**
 * Caches individual series metadata using React Query
 * @param {Function} fetchFn - Function that fetches the series metadata
 * @param {string} dataSourceName - Name of the data source
 * @param {string} StudyInstanceUID - Study Instance UID
 * @param {string} SeriesInstanceUID - Series Instance UID
 * @returns {Promise} Promise that resolves with the series metadata
 */
export async function getCachedSeriesMetadata(
  fetchFn,
  dataSourceName,
  StudyInstanceUID,
  SeriesInstanceUID
) {
  const queryClient = getQueryClient();

  // If React Query is not available, fall back to direct fetch
  if (!queryClient) {
    return fetchFn();
  }

  const queryKey = createSeriesMetadataQueryKey(dataSourceName, StudyInstanceUID, SeriesInstanceUID);

  try {
    // Check if we have cached data first
    const cachedData = queryClient.getQueryData(queryKey);
    if (cachedData) {
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
