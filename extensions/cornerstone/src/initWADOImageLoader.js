import { volumeLoader } from '@cornerstonejs/core';
import {
  cornerstoneStreamingImageVolumeLoader,
  cornerstoneStreamingDynamicImageVolumeLoader,
} from '@cornerstonejs/core/loaders';
import dicomImageLoader from '@cornerstonejs/dicom-image-loader';
import { errorHandler, utils } from '@ohif/core';
import { registerJPEGImageLoader } from './utils/jpegImageLoader';
import {
  handleDataSource406,
  navigateTo406FallbackDataSource,
  buildFallbackNavigationUrl,
  clear406FallbackPersistence,
} from './utils/dataSource406Fallback.js';

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

/** Fired from dicom-image-loader xhrRequest via init() callbacks — same bundle as XHR, always has imageId. */
function dispatchOhifDicomLoaderXhr(detail) {
  if (typeof window === 'undefined') {
    return;
  }
  window.dispatchEvent(
    new CustomEvent('ohif:dicom-loader-xhr', {
      detail,
    })
  );
}

/**
 * GETs that load DICOM bytes (uncompressed, octet-stream, multipart, per-frame, bulkdata, WADO-URI).
 */
function isLikelyDicomImageGetRequest(method, url) {
  if (method.toUpperCase() !== 'GET') {
    return false;
  }
  const urlString = typeof url === 'string' ? url : url != null ? String(url) : '';
  if (!urlString) {
    return false;
  }
  const u = urlString.toLowerCase();

  if (u.includes('wadouri') || u.includes('requesttype=wado') || u.includes('objectuid=')) {
    return true;
  }

  // WADO-RS: full instance, frames/N, or pixel bulkdata (often application/octet-stream)
  if (u.includes('/instances/') || u.includes('/bulkdata/') || u.includes('/frames/')) {
    return true;
  }

  if (
    u.includes('contenttype=application%2fdicom') ||
    u.includes('contenttype=application/dicom') ||
    u.includes('octet-stream') ||
    u.includes('application%2foctet-stream')
  ) {
    return true;
  }

  if (u.includes('sv=') && u.includes('st=')) {
    return true;
  }

  // Azure Blob and similar: path often includes transfer-syntax / DICOM hints; SAS params may vary.
  if (u.includes('blob.core.windows.net') && u.includes('dicom')) {
    return true;
  }
  if (u.includes('application-dicom') || u.includes('application%2ddicom')) {
    return true;
  }

  return false;
}

/** Final URL after redirects — real DICOM bytes usually come from blob / WADO-RS, not the 302 gateway body. */
function isLikelyDicomInstanceByteUrl(url) {
  if (!url || typeof url !== 'string') {
    return false;
  }
  const u = url.toLowerCase();
  if (u.includes('blob.core.windows.net')) {
    return true;
  }
  if (u.includes('application-dicom') || u.includes('application%2ddicom')) {
    return true;
  }
  if (u.includes('/instances/') || u.includes('/bulkdata/') || u.includes('/frames/')) {
    return true;
  }
  if (u.includes('sv=') && u.includes('sig=')) {
    return true;
  }
  return false;
}

function isWadoUriGatewayUrl(url) {
  if (!url || typeof url !== 'string') {
    return false;
  }
  const u = url.toLowerCase();
  return u.includes('wadouri') || u.includes('requesttype=wado');
}

/** 302 / gateway responses are tiny; treating them as 100% hid the real blob XHR progress. */
const TRIVIAL_PRE_INSTANCE_BYTE_LENGTH = 65536;

function shouldIgnoreProgressEventForGatewayRedirectHop(xhr, event, requestUrl) {
  const finalUrl = xhr.responseURL || '';
  if (isLikelyDicomInstanceByteUrl(finalUrl)) {
    return false;
  }
  if (!isWadoUriGatewayUrl(requestUrl)) {
    return false;
  }
  const total = event.lengthComputable && typeof event.total === 'number' ? event.total : 0;
  if (total <= 0 || total >= TRIVIAL_PRE_INSTANCE_BYTE_LENGTH) {
    return false;
  }
  return true;
}

/** Loader % should track the redirected blob/instance GET, not the wadouri 302 hop. */
function isPastWadoGatewayToInstanceBytes(xhr, requestUrl, loaded) {
  if (!isWadoUriGatewayUrl(requestUrl)) {
    return true;
  }
  const ru = xhr.responseURL || '';
  if (isLikelyDicomInstanceByteUrl(ru)) {
    return true;
  }
  const n = typeof loaded === 'number' ? loaded : 0;
  return n > TRIVIAL_PRE_INSTANCE_BYTE_LENGTH;
}

/** Attach progress + completion dispatches for ViewportGrid (works for dicom-image-loader XHR). */
function wireWadoXhrProgress(xhr, requestId, requestUrl) {
  let headerContentLength = 0;

  xhr.addEventListener('readystatechange', function onHeaders() {
    if (xhr.readyState !== 2) {
      return;
    }
    try {
      const cl = xhr.getResponseHeader && xhr.getResponseHeader('Content-Length');
      const n = cl ? parseInt(cl, 10) : 0;
      if (n > 0) {
        headerContentLength = n;
      }
    } catch (_e) {
      // ignore
    }
  });

  // Do not start the viewport loader on the gateway URL; wait for blob/instance responseURL + bytes.
  if (!isWadoUriGatewayUrl(requestUrl)) {
    dispatchWADORequestProgress({
      requestId,
      requestUrl,
      responseURL: xhr.responseURL || '',
      progress: 0,
      lengthComputable: false,
      done: false,
    });
  }

  xhr.addEventListener('progress', event => {
    if (shouldIgnoreProgressEventForGatewayRedirectHop(xhr, event, requestUrl)) {
      return;
    }

    const loaded = typeof event.loaded === 'number' ? event.loaded : 0;
    if (!isPastWadoGatewayToInstanceBytes(xhr, requestUrl, loaded)) {
      return;
    }
    const totalFromEvent =
      event.lengthComputable && typeof event.total === 'number' && event.total > 0
        ? event.total
        : 0;
    const total = totalFromEvent || (headerContentLength > 0 ? headerContentLength : 0);
    const computable = total > 0;
    const ratio = computable ? Math.min(1, loaded / total) : undefined;

    dispatchWADORequestProgress({
      requestId,
      requestUrl,
      responseURL: xhr.responseURL || '',
      progress: typeof ratio === 'number' ? ratio : undefined,
      loaded,
      total: computable ? total : undefined,
      lengthComputable: computable,
      done: false,
    });
  });

  const finishRequest = () => {
    const responseURL = xhr.responseURL || '';
    const status = typeof xhr.status === 'number' ? xhr.status : 0;
    const ok = status >= 200 && status < 300;
    // Avoid signaling "done" for a gateway-only response (no redirect to instance bytes yet).
    if (ok && isWadoUriGatewayUrl(requestUrl) && !isLikelyDicomInstanceByteUrl(responseURL)) {
      return;
    }

    dispatchWADORequestProgress({
      requestId,
      requestUrl,
      responseURL,
      status,
      progress: 1,
      lengthComputable: true,
      done: true,
    });
  };

  xhr.addEventListener('loadend', finishRequest);
  xhr.addEventListener('error', finishRequest);
  xhr.addEventListener('abort', finishRequest);
}

/**
 * Intercept XMLHttpRequest for WADO/DICOM download progress and optional image cache.
 * Progress must run even when __OHIF_IMAGE_CACHE__ is unset (dicom-image-loader still uses XHR).
 */
function interceptXHRForImageCaching() {
  if (isXHRIntercepted || typeof window === 'undefined' || !window.XMLHttpRequest) {
    return;
  }

  const OriginalXHR = window.XMLHttpRequest;
  const imageCache = getImageCache();

  window.XMLHttpRequest = function (...args) {
    const xhr = new OriginalXHR(...args);
    const originalOpen = xhr.open;
    const originalSend = xhr.send;
    let requestUrl = null;
    let isImageRequest = false;

    // Intercept open() to capture the URL
    xhr.open = function (method, url, ...rest) {
      const urlForMatch =
        typeof url === 'string'
          ? url
          : url && typeof url.toString === 'function'
            ? url.toString()
            : String(url);
      requestUrl = urlForMatch;
      isImageRequest = isLikelyDicomImageGetRequest(method, urlForMatch);

      return originalOpen.call(this, method, url, ...rest);
    };

    // Intercept send() to check cache before making the request
    xhr.send = function (...args) {
      if (!isImageRequest || !requestUrl) {
        return originalSend.apply(this, args);
      }

      const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

      if (!imageCache) {
        wireWadoXhrProgress(xhr, requestId, requestUrl);
        return originalSend.apply(this, args);
      }

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
        xhr.addEventListener = function (type, listener, options) {
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
                configurable: true,
              });
              Object.defineProperty(xhr, 'statusText', {
                value: 'OK',
                writable: true,
                configurable: true,
              });
              Object.defineProperty(xhr, 'response', {
                value: cachedData,
                writable: true,
                configurable: true,
              });
              Object.defineProperty(xhr, 'responseType', {
                value: 'arraybuffer',
                writable: true,
                configurable: true,
              });

              // Set readyState to DONE (4)
              Object.defineProperty(xhr, 'readyState', {
                value: 4,
                writable: true,
                configurable: true,
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
        wireWadoXhrProgress(xhr, requestId, requestUrl);

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
          xhr.onload = function () {
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

  // XHR hook: WADO/DICOM download % (all formats using dicom-image-loader XHR) + optional cache
  interceptXHRForImageCaching();

  // Wrap loadFileRequest with caching (only once)
  if (!isWrapped && originalLoadFileRequest) {
    const wrappedLoadFileRequest = async function (imageId) {
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
      if (
        imageCache &&
        url &&
        typeof url === 'string' &&
        (url.startsWith('http://') || url.startsWith('https://'))
      ) {
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
        if (
          imageCache &&
          result instanceof ArrayBuffer &&
          url &&
          typeof url === 'string' &&
          (url.startsWith('http://') || url.startsWith('https://'))
        ) {
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
    onloadstart: function (_event, params) {
      const imageId = params?.imageId;
      const url = params?.url;
      if (typeof imageId !== 'string') {
        return;
      }
      const openUrl = typeof url === 'string' ? url : '';
      const isGateway = isWadoUriGatewayUrl(openUrl) || isWadoUriGatewayUrl(imageId);
      if (isGateway) {
        return;
      }
      dispatchOhifDicomLoaderXhr({
        phase: 'start',
        imageId,
        url,
      });
    },
    onprogress: function (oProgress, params) {
      const imageId = params?.imageId;
      const url = params?.url;
      if (typeof imageId !== 'string') {
        return;
      }
      const openUrl = typeof url === 'string' ? url : '';
      if (isWadoUriGatewayUrl(openUrl) || isWadoUriGatewayUrl(imageId)) {
        return;
      }
      const loaded = typeof oProgress?.loaded === 'number' ? oProgress.loaded : 0;
      const total =
        oProgress?.lengthComputable && typeof oProgress.total === 'number' ? oProgress.total : 0;
      dispatchOhifDicomLoaderXhr({
        phase: 'progress',
        imageId,
        url,
        loaded,
        total,
        lengthComputable: Boolean(oProgress?.lengthComputable && total > 0),
      });
    },
    onloadend: function (_event, params) {
      const imageId = params?.imageId;
      const url = params?.url;
      if (typeof imageId !== 'string') {
        return;
      }
      dispatchOhifDicomLoaderXhr({
        phase: 'end',
        imageId,
        url,
      });
    },
    beforeSend: function () {
      //TODO should be removed in the future and request emitted by DicomWebDataSource
      const sourceConfig = extensionManager.getActiveDataSource()?.[0].getConfig() ?? {};

      const demoBasic =
        typeof window !== 'undefined' &&
        window.getDemoEnvBasicAuthToken &&
        typeof window.getDemoEnvBasicAuthToken === 'function'
          ? window.getDemoEnvBasicAuthToken()
          : null;

      const viewerBearer =
        typeof window !== 'undefined' &&
        window.getViewerAccessBearerToken &&
        typeof window.getViewerAccessBearerToken === 'function'
          ? window.getViewerAccessBearerToken()
          : null;

      let headers;
      if (demoBasic) {
        headers = {
          Authorization: `Basic ${demoBasic}`,
        };
      } else if (viewerBearer) {
        headers = {
          Authorization: `Bearer ${viewerBearer}`,
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

  // After dicomImageLoader.init — wrap dicomweb: so JPEG WADO-URI is not parsed as DICOM.
  registerJPEGImageLoader();

  if (typeof window !== 'undefined') {
    clear406FallbackPersistence();
    window.handleDataSource406 = handleDataSource406;
    window.navigateTo406FallbackDataSource = navigateTo406FallbackDataSource;
    window.build406FallbackNavigationUrl = buildFallbackNavigationUrl;
    window.clear406FallbackPersistence = clear406FallbackPersistence;
  }
}

export function destroy() {
  console.debug('Destroying WADO Image Loader');
}
