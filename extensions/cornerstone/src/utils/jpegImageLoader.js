import { imageLoader, metaData } from '@cornerstonejs/core';
import dicomImageLoader from '@cornerstonejs/dicom-image-loader';
import {
  isRedirectToRisOn401Enabled,
  resolveRis401RedirectUrlFromConfig,
} from './risRedirectConfig.js';
import { syncImageNumberOfComponents } from './syncImageNumberOfComponents.js';
import { ensureImagePreScale } from './ensureImagePreScale.js';
import { handleJpegLoader406, isUnsupportedFormatStatus } from './dataSource406Fallback.js';
import { buildJpegUrlFromImageId } from './jpegWadoUriUtils';
import { decodeJpegInWorker } from './jpegDecodeWorkerPool';
import { getWadoUriFileCacheUrl } from './wadoUriCacheUrl';
import {
  getPersistentCachedArrayBuffer,
  getPersistentCachedBlob,
  isPersistentImageCacheEnabled,
  setPersistentCachedImage,
  toPersistentImageCacheKey,
} from './persistentImageCache';

export function isJpegWadoUriImageId(imageId) {
  if (!imageId || typeof imageId !== 'string') {
    return false;
  }
  const url = imageId.includes(':') ? imageId.substring(imageId.indexOf(':') + 1) : imageId;
  return url.includes('contentType=image/jpeg') || url.includes('contentType=image%2Fjpeg');
}

function toDicomwebJpegImageId(imageId) {
  if (imageId.startsWith('dicomweb-jpeg:')) {
    return imageId;
  }
  return `dicomweb-jpeg:${imageId.replace(/^dicomweb:/i, '')}`;
}

function dispatchJPEGLoadProgress(imageId, progress, lengthComputable = true) {
  if (typeof window === 'undefined') {
    return;
  }

  window.dispatchEvent(
    new CustomEvent('ohif:jpeg-image-progress', {
      detail: {
        imageId,
        progress: Math.max(0, Math.min(1, progress)),
        lengthComputable: Boolean(lengthComputable),
      },
    })
  );
}

function isMultiframeImageId(imageId) {
  return (
    typeof imageId === 'string' && (/&frame=\d+/i.test(imageId) || /\/frames\/\d+/i.test(imageId))
  );
}

function getDicomColorHints(imageId) {
  const generalSeries = metaData.get('generalSeriesModule', imageId) || {};
  const imagePixel = metaData.get('imagePixelModule', imageId) || {};
  const modality = (generalSeries.modality || '').toUpperCase();
  const samplesPerPixel = Number(imagePixel.samplesPerPixel) || 0;
  const pi = String(imagePixel.photometricInterpretation || '').toUpperCase();

  const forceColor =
    samplesPerPixel >= 3 || pi.includes('RGB') || pi.includes('YBR') || pi === 'PALETTE COLOR';

  const forceGrayscale = samplesPerPixel === 1 && (pi === 'MONOCHROME1' || pi === 'MONOCHROME2');

  return { modality, samplesPerPixel, photometricInterpretation: pi, forceColor, forceGrayscale };
}

/**
 * Detect color in decoded JPEG pixels (sparse overlays on gray backgrounds still count).
 */
function detectColorImage(imageData, width, height) {
  const step = Math.max(1, Math.floor(Math.sqrt(width * height) / 50));
  let colorVariation = 0;
  let totalSamples = 0;
  let colorPixels = 0;
  let maxVariation = 0;

  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const pixelIndex = (y * width + x) * 4;
      if (pixelIndex + 2 >= imageData.data.length) {
        continue;
      }

      const r = imageData.data[pixelIndex];
      const g = imageData.data[pixelIndex + 1];
      const b = imageData.data[pixelIndex + 2];

      totalSamples++;
      const maxChannel = Math.max(r, g, b);
      const minChannel = Math.min(r, g, b);
      const variation = maxChannel - minChannel;
      colorVariation += variation;
      maxVariation = Math.max(maxVariation, variation);

      if (variation > 12) {
        colorPixels++;
      }
    }
  }

  const avgColorVariation = totalSamples > 0 ? colorVariation / totalSamples : 0;
  const colorRatio = totalSamples > 0 ? colorPixels / totalSamples : 0;

  return avgColorVariation > 8 || colorRatio > 0.03 || maxVariation > 20;
}

function isColorReportUrl(jpegUrl) {
  const u = (jpegUrl || '').toLowerCase();
  return (
    u.includes('4dm') ||
    u.includes('scoring') ||
    u.includes('composite') ||
    u.includes('report') ||
    u.includes('result')
  );
}

/**
 * Color decision inputs that do not need decoded pixels. Final rule:
 * `preColor || detectedAsColor || !forceGrayscale` (also applied in the decode worker).
 */
function getJpegColorPreference(imageId, jpegUrl) {
  const hints = getDicomColorHints(imageId);

  return {
    preColor: isColorByContext(hints, imageId, jpegUrl),
    forceGrayscale: hints.forceGrayscale,
  };
}

function isColorByContext(hints, imageId, jpegUrl) {
  if (hints.forceColor) {
    return true;
  }

  const urlLower = (jpegUrl || '').toLowerCase();
  const isFundusByUrl =
    urlLower.includes('fundus') ||
    urlLower.includes('retina') ||
    urlLower.includes('ophthalm') ||
    urlLower.includes('eye');
  const isEchoByUrl =
    urlLower.includes('echo') ||
    urlLower.includes('cardiac') ||
    urlLower.includes('heart') ||
    urlLower.includes('ultrasound');

  // OT secondary-capture / 4DM composite reports are color (often 1 frame).
  if (hints.modality === 'OT' && !isMultiframeImageId(imageId)) {
    return true;
  }
  if (hints.modality === 'SC' || hints.modality === 'DOC') {
    return true;
  }

  return isColorReportUrl(jpegUrl) || isFundusByUrl || isEchoByUrl;
}

/**
 * JPEG from WADO is always RGBA in canvas; only reduce to grayscale when clearly mono.
 * Multiframe OT (e.g. OCT B-scans) stays grayscale when pixels are not color.
 */
function shouldDecodeJpegAsColor(colorPreference, imageData, width, height) {
  return (
    colorPreference.preColor ||
    detectColorImage(imageData, width, height) ||
    !colorPreference.forceGrayscale
  );
}

function createCornerstoneJpegImage(imageId, { width, height, color, pixelData }) {
  const samplesPerPixel = color ? 3 : 1;
  const image = {
    imageId: imageId,
    minPixelValue: 0,
    maxPixelValue: 255,
    slope: 1,
    intercept: 0,
    windowCenter: 128,
    windowWidth: 255,
    getPixelData: () => pixelData,
    rows: height,
    columns: width,
    height: height,
    width: width,
    color: color,
    rgba: false,
    columnPixelSpacing: 0.076923076923,
    rowPixelSpacing: 0.076923076923,
    invert: false,
    sizeInBytes: pixelData.length,
    photometricInterpretation: color ? 'RGB' : 'MONOCHROME2',
    bitsAllocated: 8,
    bitsStored: 8,
    samplesPerPixel: samplesPerPixel,
    numberOfComponents: samplesPerPixel,
    planarConfiguration: 0,
    pixelRepresentation: 0,
  };

  syncImageNumberOfComponents(image);
  ensureImagePreScale(image);

  return image;
}

let mainThreadDecodeCanvas = null;

/**
 * One shared canvas; its pixel buffer is freed (size 0) right after each decode
 * instead of waiting for GC to collect a canvas per frame.
 */
function getMainThreadDecodeContext(width, height) {
  mainThreadDecodeCanvas ??= document.createElement('canvas');
  mainThreadDecodeCanvas.width = width;
  mainThreadDecodeCanvas.height = height;
  return mainThreadDecodeCanvas.getContext('2d', { willReadFrequently: true });
}

function releaseMainThreadDecodeCanvas() {
  if (mainThreadDecodeCanvas) {
    mainThreadDecodeCanvas.width = 0;
    mainThreadDecodeCanvas.height = 0;
  }
}

function decodeJpegOnMainThread(jpegBlob, colorPreference) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(jpegBlob);

    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      try {
        const ctx = getMainThreadDecodeContext(img.width, img.height);
        ctx.drawImage(img, 0, 0);

        const imageData = ctx.getImageData(0, 0, img.width, img.height);
        releaseMainThreadDecodeCanvas();
        const color = shouldDecodeJpegAsColor(colorPreference, imageData, img.width, img.height);
        const pixelCount = imageData.width * imageData.height;
        const pixelData = new Uint8Array(color ? pixelCount * 3 : pixelCount);

        for (let i = 0; i < imageData.data.length; i += 4) {
          const pixelIndex = i / 4;
          if (color) {
            pixelData[pixelIndex * 3] = imageData.data[i];
            pixelData[pixelIndex * 3 + 1] = imageData.data[i + 1];
            pixelData[pixelIndex * 3 + 2] = imageData.data[i + 2];
          } else {
            pixelData[pixelIndex] = Math.round(
              0.299 * imageData.data[i] +
                0.587 * imageData.data[i + 1] +
                0.114 * imageData.data[i + 2]
            );
          }
        }

        resolve({ width: img.width, height: img.height, color, pixelData });
      } catch (error) {
        releaseMainThreadDecodeCanvas();
        reject(new Error(`Failed to process JPEG image: ${error.message}`));
      }
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Failed to load JPEG image'));
    };

    img.src = objectUrl;
  });
}

/**
 * Process JPEG image and convert to Cornerstone format. Decodes in a worker when
 * available so many frames arriving together do not block the UI thread.
 */
async function processJPEGImage(jpegBlob, imageId, jpegUrl, resolve, reject) {
  try {
    const colorPreference = getJpegColorPreference(imageId, jpegUrl);
    const decoded =
      (await decodeJpegInWorker(jpegBlob, colorPreference)) ??
      (await decodeJpegOnMainThread(jpegBlob, colorPreference));

    const image = createCornerstoneJpegImage(imageId, decoded);

    // Mark this image is fully ready for UI loaders that rely on progress events.
    // We don't get streaming progress from `fetch()` here, but we can guarantee completion.
    dispatchJPEGLoadProgress(imageId, 1, true);
    resolve(image);
  } catch (error) {
    reject(error instanceof Error ? error : new Error(String(error)));
  }
}
// Get a cookie value by name (used for token or patientToken - both are sent to PACS WADO-URI)
function getCookie(name) {
  if (typeof document === 'undefined' || !document.cookie) return null;
  const nameEQ = name + '=';
  const cookies = document.cookie.split(';');
  for (let i = 0; i < cookies.length; i++) {
    let cookie = cookies[i].trim();
    if (cookie.indexOf(nameEQ) === 0) {
      return decodeURIComponent(cookie.substring(nameEQ.length).trim());
    }
  }
  return null;
}

// Token or patientToken from cookie - either is passed in Authorization header for WADO-URI (study/series/instance)
function getTokenFromCookie() {
  // Demo token from global helper
  if (
    typeof window !== 'undefined' &&
    window.getDemoToken &&
    typeof window.getDemoToken === 'function'
  ) {
    const demoToken = window.getDemoToken();
    if (demoToken) return demoToken;
  }
  // Get token or patientToken from cookie (parent app may set either for PACS API)
  return (
    getCookie('token') ||
    getCookie('patientToken') ||
    getCookie('accessToken') ||
    getCookie('authToken') ||
    getCookie('jwt') ||
    null
  );
}
/**
 * Custom image loader for JPEG images from WADO-URI endpoints
 */
function handleJpegLoader401(_xhr, reject) {
  const appConfig = window.config || {};
  const errorHandler = window.__OHIF_ERROR_HANDLER__;
  if (errorHandler && errorHandler._servicesManager) {
    const userAuthenticationService =
      errorHandler._servicesManager?.services?.userAuthenticationService;
    if (
      userAuthenticationService &&
      typeof userAuthenticationService.handleUnauthenticated === 'function'
    ) {
      userAuthenticationService.handleUnauthenticated();
      if (isRedirectToRisOn401Enabled(appConfig)) {
        return true;
      }
      reject(new Error('HTTP 401: Unauthorized'));
      return true;
    }
  }

  if (isRedirectToRisOn401Enabled(appConfig)) {
    const target = resolveRis401RedirectUrlFromConfig(appConfig);
    console.log('401 error in JPEG loader - redirecting to RIS:', target);
    window.location.href = target;
    return true;
  }
  reject(new Error('HTTP 401: Unauthorized'));
  return true;
}

function buildJpegAuthHeader() {
  const viewerBearer =
    typeof window !== 'undefined' &&
    window.getViewerAccessBearerToken &&
    typeof window.getViewerAccessBearerToken === 'function'
      ? window.getViewerAccessBearerToken()
      : null;

  if (viewerBearer) {
    return `Bearer ${viewerBearer}`;
  }

  const token = getTokenFromCookie();
  if (token) {
    return `Bearer ${token}`;
  }

  return '';
}

/**
 * Fetch the original JPEG bytes from a WADO-URI imageId (same auth/URL rules as the JPEG loader).
 */
export function fetchJpegBlobFromImageId(imageId) {
  const jpegUrl = buildJpegUrlFromImageId(imageId);
  return requestJpegBlob(jpegUrl).promise;
}

/** Delays before re-sending after a network-level failure (connection reset, proxy drop). */
const JPEG_NETWORK_RETRY_DELAYS_MS = [400, 1500];

function requestJpegBlob(jpegUrl, { imageId, onProgress } = {}) {
  /** @type {XMLHttpRequest | undefined} */
  let xhr;
  let cancelled = false;
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let retryTimer;
  /** @type {((reason?: unknown) => void) | undefined} */
  let rejectPending;

  const promise = new Promise((resolve, reject) => {
    rejectPending = reject;
    const send = attempt => {
      const authHeader = buildJpegAuthHeader();
      xhr = new XMLHttpRequest();
      xhr.open('GET', jpegUrl, true);
      xhr.responseType = 'blob';
      xhr.setRequestHeader('Accept', 'image/jpeg');
      xhr.setRequestHeader('Content-Type', 'image/jpeg');
      if (authHeader) {
        xhr.setRequestHeader('Authorization', authHeader);
      }

      if (onProgress) {
        xhr.onprogress = event => {
          if (event.lengthComputable && event.total > 0) {
            onProgress(Math.min(1, event.loaded / event.total));
          }
        };
      }

      xhr.onload = () => {
        try {
          if (xhr.status === 401) {
            handleJpegLoader401(xhr, reject);
            return;
          }
          if (isUnsupportedFormatStatus(xhr.status)) {
            handleJpegLoader406(xhr, reject);
            return;
          }
          if (xhr.status < 200 || xhr.status >= 300) {
            reject(new Error(`HTTP ${xhr.status}: ${xhr.statusText}`));
            return;
          }

          const jpegBlob = xhr.response;
          if (!jpegBlob || !(jpegBlob instanceof Blob)) {
            reject(new Error('Invalid JPEG response'));
            return;
          }

          if (imageId) {
            dispatchJPEGLoadProgress(imageId, 1, true);
          }

          resolve(jpegBlob);
        } catch (err) {
          reject(err);
        }
      };

      xhr.onerror = () => {
        if (!cancelled && attempt < JPEG_NETWORK_RETRY_DELAYS_MS.length) {
          retryTimer = setTimeout(() => {
            retryTimer = undefined;
            if (cancelled) {
              reject(new Error('Request aborted'));
              return;
            }
            send(attempt + 1);
          }, JPEG_NETWORK_RETRY_DELAYS_MS[attempt]);
          return;
        }
        reject(new Error(`Network error loading JPEG (${jpegUrl})`));
      };

      xhr.onabort = () => {
        reject(new Error('Request aborted'));
      };

      xhr.send();
    };

    send(0);
  });

  return {
    promise,
    cancel: () => {
      cancelled = true;
      if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = undefined;
        rejectPending?.(new Error('Request aborted'));
      }
      if (xhr && xhr.readyState !== 4) {
        xhr.abort();
      }
    },
  };
}

function loadJPEGImage(imageId) {
  const jpegUrl = buildJpegUrlFromImageId(imageId);
  let cancelled = false;
  let cancelRequest = () => {};

  const imagePromise = (async () => {
    dispatchJPEGLoadProgress(imageId, 0, true);

    const cacheKey = toPersistentImageCacheKey(jpegUrl);
    let jpegBlob = await getPersistentCachedBlob(cacheKey);

    if (!jpegBlob) {
      if (cancelled) {
        throw new Error('Request aborted');
      }

      const request = requestJpegBlob(jpegUrl, {
        imageId,
        onProgress: progress => dispatchJPEGLoadProgress(imageId, progress, true),
      });
      cancelRequest = request.cancel;
      jpegBlob = await request.promise;
      void setPersistentCachedImage(cacheKey, jpegBlob);
    }

    return new Promise((resolve, reject) => {
      processJPEGImage(jpegBlob, imageId, jpegUrl, resolve, reject);
    });
  })();

  return {
    promise: imagePromise,
    cancel: () => {
      cancelled = true;
      cancelRequest();
    },
  };
}

/**
 * dicomweb: (whole-file DICOM P10) through the persistent cache. Same flow as
 * dicom-image-loader's wadouri.loadImage, but the file download step checks
 * IndexedDB first and stores the bytes after a network fetch. One entry per
 * instance file — frames are selected after parsing, so `frame` is not in the key.
 */
function loadDicomwebImageWithPersistentCache(imageId) {
  const wadouri = dicomImageLoader?.wadouri;
  const canUseCache =
    isPersistentImageCacheEnabled() &&
    typeof wadouri?.parseImageId === 'function' &&
    typeof wadouri?.loadImageFromPromise === 'function' &&
    typeof wadouri?.getLoaderForScheme === 'function' &&
    wadouri?.dataSetCacheManager;

  if (!canUseCache) {
    return wadouri.loadImage(imageId);
  }

  const parsed = wadouri.parseImageId(imageId);
  const networkLoader = wadouri.getLoaderForScheme(parsed.scheme);

  if (!networkLoader || wadouri.dataSetCacheManager.isLoaded(parsed.url)) {
    return wadouri.loadImage(imageId);
  }

  const cachingLoader = async (uri, requestImageId) => {
    const cacheKey = toPersistentImageCacheKey(getWadoUriFileCacheUrl(uri));
    const cached = await getPersistentCachedArrayBuffer(cacheKey);

    if (cached) {
      // Viewport download overlays finish on this event; a cache hit has no XHR.
      window.dispatchEvent(
        new CustomEvent('ohif:dicom-loader-xhr', {
          detail: { phase: 'end', imageId: requestImageId, url: uri },
        })
      );
      return cached;
    }

    const result = await networkLoader(uri, requestImageId);

    if (result instanceof ArrayBuffer) {
      void setPersistentCachedImage(cacheKey, result);
    }

    return result;
  };

  const dataSetPromise = wadouri.dataSetCacheManager.load(parsed.url, cachingLoader, imageId);
  return wadouri.loadImageFromPromise(dataSetPromise, imageId, parsed.frame, parsed.url, {});
}

/**
 * Route dicomweb: JPEG WADO-URI through the JPEG loader (DICOM parser cannot read JPEG bytes).
 * Must run after dicomImageLoader.init() so wadouri.loadImage exists.
 */
function wrapDicomwebLoaderForJpeg() {
  const dicomwebLoader =
    typeof dicomImageLoader?.wadouri?.loadImage === 'function'
      ? loadDicomwebImageWithPersistentCache
      : null;

  imageLoader.registerImageLoader('dicomweb', imageId => {
    if (isJpegWadoUriImageId(imageId)) {
      return loadJPEGImage(toDicomwebJpegImageId(imageId));
    }
    if (!dicomwebLoader) {
      throw new Error(`No DICOM loader available for imageId: ${imageId}`);
    }
    return dicomwebLoader(imageId);
  });
}

/**
 * Register the JPEG image loader with Cornerstone
 */
export function registerJPEGImageLoader() {
  try {
    imageLoader.registerImageLoader('jpeg', loadJPEGImage);
    imageLoader.registerImageLoader('dicomweb-jpeg', loadJPEGImage);
    wrapDicomwebLoaderForJpeg();
    console.log('JPEG Image Loader registered successfully');
  } catch (error) {
    console.error('Error registering JPEG Image Loader:', error);
  }
}
