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
 * Creates a unique query key for studies search caching
 * @param {string} dataSourceName - Name of the data source
 * @param {Object} params - Search parameters
 * @returns {Array} Query key array for React Query
 */
export function createStudiesQueryKey(dataSourceName, params) {
  // Create a stable key from params
  const sortedParams = Object.keys(params || {})
    .sort()
    .reduce((acc, key) => {
      const value = params[key];
      // Handle arrays by sorting them
      if (Array.isArray(value)) {
        acc[key] = value.slice().sort().join(',');
      } else {
        acc[key] = value;
      }
      return acc;
    }, {});

  return ['studiesSearch', dataSourceName, JSON.stringify(sortedParams)];
}

/**
 * Caches studies search results using React Query
 * @param {Function} fetchFn - Function that fetches the studies
 * @param {string} dataSourceName - Name of the data source
 * @param {Object} params - Search parameters
 * @returns {Promise} Promise that resolves with the studies
 */
export async function getCachedStudiesSearch(fetchFn, dataSourceName, params) {
  const queryClient = getQueryClient();

  // If React Query is not available, fall back to direct fetch
  if (!queryClient) {
    return fetchFn();
  }

  const queryKey = createStudiesQueryKey(dataSourceName, params);

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
      staleTime: 1000, // 5 minutes - studies list changes more frequently
      gcTime: 1000, // 1 hour - keep in cache for 1 hour
    });

    return data;
  } catch (error) {
    // If there's an error with React Query, fall back to direct fetch
    return fetchFn();
  }
}
