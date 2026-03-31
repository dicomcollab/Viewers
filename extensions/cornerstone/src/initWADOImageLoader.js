import { volumeLoader } from '@cornerstonejs/core';
import {
  cornerstoneStreamingImageVolumeLoader,
  cornerstoneStreamingDynamicImageVolumeLoader,
} from '@cornerstonejs/core/loaders';
import dicomImageLoader from '@cornerstonejs/dicom-image-loader';
import { errorHandler, utils } from '@ohif/core';
import { registerJPEGImageLoader } from './utils/jpegImageLoader';

// Get image cache utilities from global window object
const getImageCache = () => {
  if (typeof window !== 'undefined' && window.__OHIF_IMAGE_CACHE__) {
    return window.__OHIF_IMAGE_CACHE__;
  }
  return null;
};

// Wrap the original loadFileRequest to add caching
const originalLoadFileRequest = dicomImageLoader.wadouri.loadFileRequest;
let isWrapped = false;
let isXHRIntercepted = false;

function dispatchWADORequestProgress(detail) {
  if (typeof window === 'undefined') {
    return;
  }

  window.dispatchEvent(
    new CustomEvent('ohif:wado-image-request-progress', {
      detail,
    })
  );
}

/**
 * Intercept XMLHttpRequest to cache WADO-URI image requests
 * This catches all XHR requests, including those made by dicom-image-loader
 */
function interceptXHRForImageCaching() {
  if (isXHRIntercepted || typeof window === 'undefined' || !window.XMLHttpRequest) {
    return;
  }

  const OriginalXHR = window.XMLHttpRequest;
  const imageCache = getImageCache();

  if (!imageCache) {
    return;
  }

  window.XMLHttpRequest = function(...args) {
    const xhr = new OriginalXHR(...args);
    const originalOpen = xhr.open;
    const originalSend = xhr.send;
    let requestUrl = null;
    let isImageRequest = false;

    // Intercept open() to capture the URL
    xhr.open = function(method, url, ...rest) {
      requestUrl = url;
      // Check if this is a WADO-URI image request or DICOM image request
      // Patterns to match:
      // - wadouri?requestType=WADO&...
      // - URLs with objectUID= (DICOM instance identifier)
      // - Azure blob URLs that might be redirected from WADO-URI (contain sv= and st= query params)
      isImageRequest =
        typeof url === 'string' &&
        (url.includes('wadouri') ||
         url.includes('requestType=WADO') ||
         url.includes('objectUID=') ||
         (url.includes('sv=') && url.includes('st=') && method.toUpperCase() === 'GET')); // Azure blob storage redirects

      return originalOpen.call(this, method, url, ...rest);
    };

    // Intercept send() to check cache before making the request
    xhr.send = function(...args) {
      if (!isImageRequest || !requestUrl || !imageCache) {
        return originalSend.apply(this, args);
      }
      const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

      // Check cache first (synchronously check if possible, but async is fine)
      const cachePromise = imageCache.getCachedImage(requestUrl);

      // Store original event handlers
      const originalOnLoad = xhr.onload;
      const originalOnReadyStateChange = xhr.onreadystatechange;
      const loadListeners = [];
      const readyStateChangeListeners = [];

      // Capture existing event listeners
      if (xhr.addEventListener) {
        const originalAddEventListener = xhr.addEventListener;
        xhr.addEventListener = function(type, listener, options) {
          if (type === 'load') {
            loadListeners.push({ listener, options });
          } else if (type === 'readystatechange') {
            readyStateChangeListeners.push({ listener, options });
          } else {
            originalAddEventListener.call(this, type, listener, options);
          }
        };
      }

      cachePromise
        .then(cachedData => {
          if (cachedData && cachedData instanceof ArrayBuffer) {
            // Cache hit - simulate a successful response
            // Set response properties using defineProperty to override readonly properties
            try {
              Object.defineProperty(xhr, 'status', {
                value: 200,
                writable: true,
                configurable: true
              });
              Object.defineProperty(xhr, 'statusText', {
                value: 'OK',
                writable: true,
                configurable: true
              });
              Object.defineProperty(xhr, 'response', {
                value: cachedData,
                writable: true,
                configurable: true
              });
              Object.defineProperty(xhr, 'responseType', {
                value: 'arraybuffer',
                writable: true,
                configurable: true
              });

              // Set readyState to DONE (4)
              Object.defineProperty(xhr, 'readyState', {
                value: 4,
                writable: true,
                configurable: true
              });

              // Trigger readystatechange first (for compatibility)
              if (originalOnReadyStateChange) {
                originalOnReadyStateChange.call(xhr);
              }
              readyStateChangeListeners.forEach(({ listener }) => {
                try {
                  listener.call(xhr, new Event('readystatechange'));
                } catch (e) {
                  // Ignore errors in listeners
                }
              });

              // Then trigger load event
              if (originalOnLoad) {
                originalOnLoad.call(xhr, new Event('load'));
              }
              loadListeners.forEach(({ listener }) => {
                try {
                  listener.call(xhr, new Event('load'));
                } catch (e) {
                  // Ignore errors in listeners
                }
              });

              // Also dispatch events if addEventListener was used
              if (xhr.dispatchEvent) {
                xhr.dispatchEvent(new Event('readystatechange'));
                xhr.dispatchEvent(new Event('load'));
              }
            } catch (error) {
              // Fall back to network request
              proceedWithNetworkRequest();
            }
          } else {
            // Cache miss - proceed with original request
            proceedWithNetworkRequest();
          }
        })
        .catch(error => {
          // If cache check fails, proceed with network request
          proceedWithNetworkRequest();
        });

      const proceedWithNetworkRequest = () => {
        dispatchWADORequestProgress({
          requestId,
          requestUrl,
          progress: 0,
          lengthComputable: false,
          done: false,
        });

        if (xhr.addEventListener) {
          xhr.addEventListener('progress', event => {
            if (!event.total) {
              dispatchWADORequestProgress({
                requestId,
                requestUrl,
                progress: 0,
                lengthComputable: false,
                done: false,
              });
              return;
            }

            dispatchWADORequestProgress({
              requestId,
              requestUrl,
              progress: event.loaded / event.total,
              lengthComputable: Boolean(event.lengthComputable),
              done: false,
            });
          });

          const finishRequest = () => {
            dispatchWADORequestProgress({
              requestId,
              requestUrl,
              progress: 1,
              lengthComputable: true,
              done: true,
            });
          };

          xhr.addEventListener('loadend', finishRequest);
          xhr.addEventListener('error', finishRequest);
          xhr.addEventListener('abort', finishRequest);
        }

        // Restore original event handlers and add caching logic
        const cacheResponse = () => {
          if (xhr.status === 200 && xhr.response instanceof ArrayBuffer) {
            // Cache based on original URL
            imageCache.setCachedImage(requestUrl, xhr.response).catch(() => {
              // Silently fail
            });

            // Also cache based on final URL if redirected (for future requests that might use the redirect URL directly)
            if (xhr.responseURL && xhr.responseURL !== requestUrl) {
              imageCache.setCachedImage(xhr.responseURL, xhr.response).catch(err => {
                // Silently fail - this is just an optimization
              });
            }
          }
        };

        if (originalOnLoad) {
          xhr.onload = function() {
            cacheResponse();
            originalOnLoad.call(xhr);
          };
        } else {
          // Add load listener to cache response
          if (xhr.addEventListener) {
            xhr.addEventListener('load', cacheResponse);
          } else if (!xhr.onload) {
            xhr.onload = cacheResponse;
          }
        }

        // Restore other listeners
        loadListeners.forEach(({ listener, options }) => {
          if (xhr.addEventListener) {
            xhr.addEventListener('load', listener, options);
          }
        });
        readyStateChangeListeners.forEach(({ listener, options }) => {
          if (xhr.addEventListener) {
            xhr.addEventListener('readystatechange', listener, options);
          }
        });

        return originalSend.call(xhr, ...args);
      };
    };

    return xhr;
  };

  // Copy static properties
  Object.setPrototypeOf(window.XMLHttpRequest, OriginalXHR);
  Object.setPrototypeOf(window.XMLHttpRequest.prototype, OriginalXHR.prototype);

  isXHRIntercepted = true;
}

const { registerVolumeLoader } = volumeLoader;

export default function initWADOImageLoader(
  userAuthenticationService,
  appConfig,
  extensionManager
) {
  registerVolumeLoader('cornerstoneStreamingImageVolume', cornerstoneStreamingImageVolumeLoader);

  registerVolumeLoader(
    'cornerstoneStreamingDynamicImageVolume',
    cornerstoneStreamingDynamicImageVolumeLoader
  );

  // Intercept XHR requests for image caching (do this early, before any images load)
  interceptXHRForImageCaching();

  // Register JPEG image loader when data source is localviewer-image-jpeg
  const activeDataSource = extensionManager.getActiveDataSource()?.[0];
  const dataSourceName = activeDataSource?.sourceName || appConfig.defaultDataSourceName;

  if (dataSourceName === 'localviewer-image-jpeg') {
    registerJPEGImageLoader();
  }

  // Wrap loadFileRequest with caching (only once)
  if (!isWrapped && originalLoadFileRequest) {
    const wrappedLoadFileRequest = async function(imageId) {
      const imageCache = getImageCache();

      // Extract the actual URL from imageId (remove protocol prefix if present)
      // imageId format: 'dicomweb:http://...' or 'dicomweb-jpeg:http://...'
      let url = null;
      if (imageId && typeof imageId === 'string') {
        // Check if it starts with dicomweb protocol
        if (imageId.startsWith('dicomweb:') || imageId.startsWith('dicomweb-jpeg:')) {
          // Extract URL after the colon
          url = imageId.substring(imageId.indexOf(':') + 1);
          // Remove any leading slashes
          if (url.startsWith('//')) {
            url = url.substring(2);
          }
        } else if (imageId.startsWith('http://') || imageId.startsWith('https://')) {
          // Already a direct URL
          url = imageId;
        }
      }

      // Try to get from cache first (only for valid HTTP URL strings)
      if (imageCache && url && typeof url === 'string' && (url.startsWith('http://') || url.startsWith('https://'))) {
        try {
          const cachedData = await imageCache.getCachedImage(url);
          if (cachedData && cachedData instanceof ArrayBuffer) {
            // Return cached ArrayBuffer - dicomImageLoader expects this format
            return cachedData;
          }
        } catch (error) {
          // If cache fails, continue with network fetch
        }
      }

      try {
        // Call the original loadFileRequest
        const result = await originalLoadFileRequest.call(this, imageId);

        // Cache the result if it's an ArrayBuffer and we have a valid HTTP URL
        if (imageCache && result instanceof ArrayBuffer && url && typeof url === 'string' && (url.startsWith('http://') || url.startsWith('https://'))) {
          // Store in cache asynchronously (don't wait)
          imageCache.setCachedImage(url, result).catch(() => {
            // Silently fail - don't break image loading
          });
        }

        return result;
      } catch (error) {
        // If original fails, throw the error
        throw error;
      }
    };

    // Replace the function
    dicomImageLoader.wadouri.loadFileRequest = wrappedLoadFileRequest;
    isWrapped = true;
  }

  dicomImageLoader.init({
    maxWebWorkers: Math.min(
      Math.max(navigator.hardwareConcurrency - 1, 1),
      appConfig.maxNumberOfWebWorkers
    ),
    beforeSend: function () {
      //TODO should be removed in the future and request emitted by DicomWebDataSource
      const sourceConfig = extensionManager.getActiveDataSource()?.[0].getConfig() ?? {};

      // Check if we're on a demo route and use demo token
      const isDemo =
        typeof window !== 'undefined' &&
        window.isDemoRoute &&
        typeof window.isDemoRoute === 'function'
          ? window.isDemoRoute()
          : false;
      const demoToken =
        typeof window !== 'undefined' &&
        window.getDemoToken &&
        typeof window.getDemoToken === 'function'
          ? window.getDemoToken()
          : null;

      let headers;
      if (isDemo && demoToken) {
        // Use Basic auth for demo token
        headers = {
          Authorization: `Basic ${demoToken}`,
        };
      } else {
        headers = userAuthenticationService.getAuthorizationHeader();
      }

      const acceptHeader = utils.generateAcceptHeader(
        sourceConfig.acceptHeader,
        sourceConfig.requestTransferSyntaxUID,
        sourceConfig.omitQuotationForMultipartRequest
      );

      const xhrRequestHeaders = {
        Accept: Array.isArray(acceptHeader) ? acceptHeader.join(', ') : acceptHeader,
      };

      if (headers) {
        Object.assign(xhrRequestHeaders, headers);
      }

      return xhrRequestHeaders;
    },
    errorInterceptor: () => {
      errorHandler.getHTTPErrorHandler();
    },
  });
}

export function destroy() {
  console.debug('Destroying WADO Image Loader');
}
