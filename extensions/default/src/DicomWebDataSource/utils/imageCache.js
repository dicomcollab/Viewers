/**
 * IndexedDB-based cache for DICOM images
 * Uses IndexedDB to store binary image data (ArrayBuffer)
 */

const DB_NAME = 'ohif-image-cache';
const DB_VERSION = 1;
const STORE_NAME = 'images';
const CACHE_DURATION = 60 * 60 * 1000; // 1 hour

let dbPromise = null;

/**
 * Initialize IndexedDB
 */
function initDB() {
  if (dbPromise) {
    return dbPromise;
  }

  if (typeof window === 'undefined' || !window.indexedDB) {
    return Promise.resolve(null);
  }

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      resolve(null); // Resolve with null instead of rejecting to allow fallback
    };

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const objectStore = db.createObjectStore(STORE_NAME, { keyPath: 'url' });
        objectStore.createIndex('timestamp', 'timestamp', { unique: false });
      }
    };
  });

  return dbPromise;
}

/**
 * Get cached image from IndexedDB
 * @param {string} url - Image URL
 * @returns {Promise<ArrayBuffer|null>} Cached image data or null
 */
export async function getCachedImage(url) {
  try {
    const db = await initDB();
    if (!db) {
      return null;
    }

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(url);

      request.onsuccess = () => {
        const result = request.result;
        if (!result) {
          resolve(null);
          return;
        }

        // Check if cache is expired
        const age = Date.now() - result.timestamp;
        if (age > CACHE_DURATION) {
          // Delete expired entry
          deleteCachedImage(url);
          resolve(null);
          return;
        }

        resolve(result.data);
      };

      request.onerror = () => {
        resolve(null); // Return null on error to allow fallback
      };
    });
  } catch (error) {
    return null;
  }
}

/**
 * Store image in IndexedDB cache
 * @param {string} url - Image URL
 * @param {ArrayBuffer} data - Image data
 */
export async function setCachedImage(url, data) {
  try {
    const db = await initDB();
    if (!db) {
      return;
    }

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);

      const cacheEntry = {
        url,
        data,
        timestamp: Date.now(),
      };

      const request = store.put(cacheEntry);

      request.onsuccess = () => {
        resolve();
      };

      request.onerror = () => {
        // Don't log as error - IndexedDB might be full or have quota issues
        // Just silently fail and continue without cache
        resolve(); // Resolve anyway to not break the flow
      };
    });
  } catch (error) {
    // Silently fail - don't break image loading if cache fails
  }
}

/**
 * Delete cached image
 * @param {string} url - Image URL
 */
async function deleteCachedImage(url) {
  try {
    const db = await initDB();
    if (!db) {
      return;
    }

    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    store.delete(url);
  } catch (error) {
    // Silently fail
  }
}

/**
 * Clear all cached images (useful for cleanup)
 */
export async function clearImageCache() {
  try {
    const db = await initDB();
    if (!db) {
      return;
    }

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.clear();

      request.onsuccess = () => {
        resolve();
      };

      request.onerror = () => {
        resolve();
      };
    });
  } catch (error) {
    // Silently fail
  }
}

/**
 * Get cache statistics
 */
export async function getImageCacheStats() {
  try {
    const db = await initDB();
    if (!db) {
      return { available: false };
    }

    return new Promise((resolve) => {
      const transaction = db.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.count();

      request.onsuccess = () => {
        resolve({
          available: true,
          count: request.result,
        });
      };

      request.onerror = () => {
        resolve({ available: false });
      };
    });
  } catch (error) {
    return { available: false };
  }
}

// Make image cache available globally for use in other modules
if (typeof window !== 'undefined') {
  window.__OHIF_IMAGE_CACHE__ = {
    getCachedImage,
    setCachedImage,
    clearImageCache,
    getImageCacheStats,
  };
}
