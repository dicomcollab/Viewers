import { QueryClient } from '@tanstack/react-query';

const CACHE_KEY = 'ohif-react-query-cache';
const CACHE_VERSION = '1.0';

/**
 * Load cached data from localStorage
 */
function loadCacheFromStorage() {
  try {
    if (typeof window === 'undefined' || !window.localStorage) {
      return undefined;
    }

    const cached = localStorage.getItem(CACHE_KEY);
    if (!cached) {
      return undefined;
    }

    const parsed = JSON.parse(cached);

    // Check cache version to handle migrations
    if (parsed.version !== CACHE_VERSION) {
      localStorage.removeItem(CACHE_KEY);
      return undefined;
    }

    // Check if cache is expired (older than 1 hour)
    const now = Date.now();
    if (parsed.timestamp && now - parsed.timestamp > 60 * 60 * 1000) {
      localStorage.removeItem(CACHE_KEY);
      return undefined;
    }

    return parsed.cache;
  } catch (error) {
    return undefined;
  }
}

/**
 * Save cache to localStorage
 */
function saveCacheToStorage(cache: any) {
  try {
    if (typeof window === 'undefined' || !window.localStorage) {
      return;
    }

    const data = {
      version: CACHE_VERSION,
      timestamp: Date.now(),
      cache: cache,
    };

    const serialized = JSON.stringify(data);

    // Check size (localStorage typically has 5-10MB limit)
    const sizeInMB = new Blob([serialized]).size / (1024 * 1024);
    if (sizeInMB > 4) {
      // Try to save only study metadata (not other queries)
      const filteredCache: Record<string, any> = {};
      Object.entries(cache).forEach(([key, value]) => {
        try {
          const queryKey = JSON.parse(key);
          if (Array.isArray(queryKey) && queryKey[0] === 'studyMetadata') {
            filteredCache[key] = value;
          }
        } catch (e) {
          // Ignore invalid keys
        }
      });

      const filteredData = {
        version: CACHE_VERSION,
        timestamp: Date.now(),
        cache: filteredCache,
      };

      const filteredSerialized = JSON.stringify(filteredData);
      const filteredSizeInMB = new Blob([filteredSerialized]).size / (1024 * 1024);

      if (filteredSizeInMB < 4) {
        localStorage.setItem(CACHE_KEY, filteredSerialized);
      }
      return;
    }

    localStorage.setItem(CACHE_KEY, serialized);
  } catch (error: any) {
    // Check if it's a quota exceeded error
    if (error.name === 'QuotaExceededError' || error.code === 22) {
      try {
        localStorage.removeItem(CACHE_KEY);
      } catch (e) {
        // Ignore cleanup errors
      }
    }
  }
}

/**
 * Global QueryClient instance for React Query caching
 * This allows us to use React Query caching from anywhere in the application,
 * including non-React code like data source implementations
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Cache study metadata for 1 hour (3600000 ms)
      staleTime: 60 * 60 * 1000, // 1 hour
      // Keep cached data for 1 hour even if unused
      gcTime: 60 * 60 * 1000, // 1 hour (formerly cacheTime)
      // Retry failed requests 2 times
      retry: 2,
      // Don't refetch on window focus for study metadata
      refetchOnWindowFocus: false,
      // Don't refetch on reconnect for study metadata
      refetchOnReconnect: false,
    },
  },
});

// Load cache from localStorage on initialization
if (typeof window !== 'undefined') {
  const cachedData = loadCacheFromStorage();
  if (cachedData) {
    try {
      // Restore cached queries
      let restoredCount = 0;
      Object.entries(cachedData).forEach(([key, value]: [string, any]) => {
        try {
          const queryKey = JSON.parse(key);
          queryClient.setQueryData(queryKey, value.data, {
            updatedAt: value.dataUpdatedAt,
          });
          restoredCount++;
        } catch (e) {
          // Ignore restore errors
        }
      });
    } catch (error) {
      // Ignore restore errors
    }
  }

  // Save cache to localStorage periodically and on visibility change
  let saveTimeout: NodeJS.Timeout;
  const scheduleSave = () => {
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => {
      const queryCache = queryClient.getQueryCache();
      const allQueries = queryCache.getAll();
      const cacheData: Record<string, any> = {};

      allQueries.forEach(query => {
        if (query.state.data !== undefined) {
          const key = JSON.stringify(query.queryKey);
          cacheData[key] = {
            data: query.state.data,
            dataUpdatedAt: query.state.dataUpdatedAt,
          };
        }
      });

      saveCacheToStorage(cacheData);
    }, 1000); // Debounce saves
  };

  // Save cache when queries are updated
  queryClient.getQueryCache().subscribe(event => {
    if (event?.type === 'updated' || event?.type === 'added') {
      scheduleSave();
    }
  });

  // Save cache before page unload
  window.addEventListener('beforeunload', () => {
    const queryCache = queryClient.getQueryCache();
    const allQueries = queryCache.getAll();
    const cacheData: Record<string, any> = {};

    allQueries.forEach(query => {
      if (query.state.data !== undefined) {
        const key = JSON.stringify(query.queryKey);
        cacheData[key] = {
          data: query.state.data,
          dataUpdatedAt: query.state.dataUpdatedAt,
        };
      }
    });

    saveCacheToStorage(cacheData);
  });

  // Make queryClient available globally for use in extensions
  // @ts-ignore - Adding to window for global access
  window.__OHIF_QUERY_CLIENT__ = queryClient;

  // Note: Image cache will initialize itself when imageCache.js module is loaded
  // It sets window.__OHIF_IMAGE_CACHE__ automatically

  // Expose cache stats function for debugging
  // @ts-ignore
  window.__OHIF_CACHE_STATS__ = () => {
    const queryCache = queryClient.getQueryCache();
    const allQueries = queryCache.getAll();
    const studyMetadataQueries = allQueries.filter(q =>
      Array.isArray(q.queryKey) && q.queryKey[0] === 'studyMetadata'
    );

    console.log('=== OHIF React Query Cache Stats ===');
    console.log(`Total queries: ${allQueries.length}`);
    console.log(`Study metadata queries: ${studyMetadataQueries.length}`);
    console.log('Cached studies:');
    studyMetadataQueries.forEach(q => {
      const studyUID = Array.isArray(q.queryKey) ? q.queryKey[2] : 'unknown';
      const age = q.state.dataUpdatedAt ? Math.round((Date.now() - q.state.dataUpdatedAt) / 1000) : null;
      console.log(`  - Study: ${studyUID}, Has data: ${q.state.data !== undefined}, Age: ${age ? `${age}s` : 'N/A'}`);
    });
    console.log('====================================');

    // Check localStorage cache
    try {
      const cached = localStorage.getItem(CACHE_KEY);
      if (cached) {
        const parsed = JSON.parse(cached);
        const cacheSize = new Blob([cached]).size / (1024 * 1024);
        console.log(`localStorage cache: ${Object.keys(parsed.cache || {}).length} queries, ${cacheSize.toFixed(2)}MB`);
      } else {
        console.log('localStorage cache: empty');
      }
    } catch (e) {
      console.log('localStorage cache: error reading');
    }
  };
}
