import { imageLoader, metaData } from '@cornerstonejs/core';
import dicomImageLoader from '@cornerstonejs/dicom-image-loader';
import {
  isRedirectToRisOn401Enabled,
  resolveRis401RedirectUrlFromConfig,
} from './risRedirectConfig.js';
import { syncImageNumberOfComponents } from './syncImageNumberOfComponents.js';
import { ensureImagePreScale } from './ensureImagePreScale.js';
import { handleJpegLoader406 } from './dataSource406Fallback.js';

export function isJpegWadoUriImageId(imageId) {
  if (!imageId || typeof imageId !== 'string') {
    return false;
  }
  const url = imageId.includes(':') ? imageId.substring(imageId.indexOf(':') + 1) : imageId;
  return (
    url.includes('contentType=image/jpeg') || url.includes('contentType=image%2Fjpeg')
  );
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
    typeof imageId === 'string' &&
    (/&frame=\d+/i.test(imageId) || /\/frames\/\d+/i.test(imageId))
  );
}

function getDicomColorHints(imageId) {
  const generalSeries = metaData.get('generalSeriesModule', imageId) || {};
  const imagePixel = metaData.get('imagePixelModule', imageId) || {};
  const modality = (generalSeries.modality || '').toUpperCase();
  const samplesPerPixel = Number(imagePixel.samplesPerPixel) || 0;
  const pi = String(imagePixel.photometricInterpretation || '').toUpperCase();

  const forceColor =
    samplesPerPixel >= 3 ||
    pi.includes('RGB') ||
    pi.includes('YBR') ||
    pi === 'PALETTE COLOR';

  const forceGrayscale =
    samplesPerPixel === 1 && (pi === 'MONOCHROME1' || pi === 'MONOCHROME2');

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
 * JPEG from WADO is always RGBA in canvas; only reduce to grayscale when clearly mono.
 */
function shouldDecodeJpegAsColor(imageId, jpegUrl, imageData, width, height) {
  const hints = getDicomColorHints(imageId);
  const detectedAsColor = detectColorImage(imageData, width, height);

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

  if (isColorReportUrl(jpegUrl) || isFundusByUrl || isEchoByUrl || detectedAsColor) {
    return true;
  }

  // Multiframe OT (e.g. OCT B-scans) stays grayscale when pixels are not color.
  if (hints.forceGrayscale && !detectedAsColor) {
    return false;
  }

  // Default: preserve JPEG color unless explicitly mono DICOM.
  return !hints.forceGrayscale;
}

/**
 * Process JPEG image and convert to Cornerstone format
 */
async function processJPEGImage(jpegBlob, imageId, jpegUrl, resolve, reject) {
  const img = new Image();

  img.onload = () => {
    try {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      canvas.width = img.width;
      canvas.height = img.height;
      ctx.drawImage(img, 0, 0);

      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

      let pixelData, color, rgba, photometricInterpretation, samplesPerPixel, sizeInBytes;

      const isColorImage = shouldDecodeJpegAsColor(
        imageId,
        jpegUrl,
        imageData,
        canvas.width,
        canvas.height
      );

      if (isColorImage) {
        // Convert RGBA to RGB for color images
        pixelData = new Uint8Array(imageData.width * imageData.height * 3);
        for (let i = 0; i < imageData.data.length; i += 4) {
          const pixelIndex = i / 4;
          pixelData[pixelIndex * 3] = imageData.data[i]; // R
          pixelData[pixelIndex * 3 + 1] = imageData.data[i + 1]; // G
          pixelData[pixelIndex * 3 + 2] = imageData.data[i + 2]; // B
        }
        color = true;
        rgba = false;
        photometricInterpretation = 'RGB';
        samplesPerPixel = 3;
      } else {
        // Convert to grayscale
        pixelData = new Uint8Array(imageData.width * imageData.height);
        for (let i = 0; i < imageData.data.length; i += 4) {
          const pixelIndex = i / 4;
          pixelData[pixelIndex] = Math.round(
            0.299 * imageData.data[i] +
              0.587 * imageData.data[i + 1] +
              0.114 * imageData.data[i + 2]
          );
        }
        color = false;
        rgba = false;
        photometricInterpretation = 'MONOCHROME2';
        samplesPerPixel = 1;
      }

      sizeInBytes = pixelData.length;

      const image = {
        imageId: imageId,
        minPixelValue: 0,
        maxPixelValue: 255,
        slope: 1,
        intercept: 0,
        windowCenter: 128,
        windowWidth: 255,
        getPixelData: () => pixelData,
        rows: img.height,
        columns: img.width,
        height: img.height,
        width: img.width,
        color: color,
        rgba: rgba,
        columnPixelSpacing: 0.076923076923,
        rowPixelSpacing: 0.076923076923,
        invert: false,
        sizeInBytes: sizeInBytes,
        photometricInterpretation: photometricInterpretation,
        bitsAllocated: 8,
        bitsStored: 8,
        samplesPerPixel: samplesPerPixel,
        numberOfComponents: samplesPerPixel,
        planarConfiguration: 0,
        pixelRepresentation: 0,
      };

      syncImageNumberOfComponents(image);
      ensureImagePreScale(image);

      // Mark this image is fully ready for UI loaders that rely on progress events.
      // We don't get streaming progress from `fetch()` here, but we can guarantee completion.
      dispatchJPEGLoadProgress(imageId, 1, true);
      resolve(image);
    } catch (error) {
      reject(new Error(`Failed to process JPEG image: ${error.message}`));
    }
  };

  img.onerror = () => {
    reject(new Error('Failed to load JPEG image'));
  };

  img.src = URL.createObjectURL(jpegBlob);
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
  return getCookie('token') || getCookie('patientToken') || getCookie('accessToken') || getCookie('authToken') || getCookie('jwt') || null;
}
/**
 * Custom image loader for JPEG images from WADO-URI endpoints
 */
function handleJpegLoader401(_xhr, reject) {
  const appConfig = window.config || {};
  const errorHandler = window.__OHIF_ERROR_HANDLER__;
  if (errorHandler && errorHandler._servicesManager) {
    const userAuthenticationService = errorHandler._servicesManager?.services?.userAuthenticationService;
    if (userAuthenticationService && typeof userAuthenticationService.handleUnauthenticated === 'function') {
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

function buildJpegUrlFromImageId(imageId) {
  let dicomUrl = imageId.replace('dicomweb-jpeg:', '').replace('dicomweb:', '');
  const urlWithoutFrame = dicomUrl.split('&frame=')[0];
  let jpegUrl = urlWithoutFrame.replace(
    'contentType=application/dicom',
    'contentType=image/jpeg'
  );

  if (!jpegUrl.includes('contentType=')) {
    const separator = jpegUrl.includes('?') ? '&' : '?';
    jpegUrl = `${jpegUrl}${separator}contentType=image/jpeg`;
  }

  return jpegUrl;
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

function requestJpegBlob(jpegUrl, { imageId, onProgress } = {}) {
  /** @type {XMLHttpRequest | undefined} */
  let xhr;

  const promise = new Promise((resolve, reject) => {
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
        if (xhr.status === 406) {
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
      reject(new Error('Network error loading JPEG'));
    };

    xhr.onabort = () => {
      reject(new Error('Request aborted'));
    };

    xhr.send();
  });

  return {
    promise,
    cancel: () => {
      if (xhr && xhr.readyState !== 4) {
        xhr.abort();
      }
    },
  };
}

function loadJPEGImage(imageId) {
  const jpegUrl = buildJpegUrlFromImageId(imageId);
  const { promise, cancel } = requestJpegBlob(jpegUrl, {
    imageId,
    onProgress: progress => dispatchJPEGLoadProgress(imageId, progress, true),
  });

  const imagePromise = (async () => {
    dispatchJPEGLoadProgress(imageId, 0, true);
    const jpegBlob = await promise;
    return new Promise((resolve, reject) => {
      processJPEGImage(jpegBlob, imageId, jpegUrl, resolve, reject);
    });
  })();

  return {
    promise: imagePromise,
    cancel,
  };
}

/**
 * Route dicomweb: JPEG WADO-URI through the JPEG loader (DICOM parser cannot read JPEG bytes).
 * Must run after dicomImageLoader.init() so wadouri.loadImage exists.
 */
function wrapDicomwebLoaderForJpeg() {
  const dicomwebLoader =
    typeof dicomImageLoader?.wadouri?.loadImage === 'function'
      ? imageId => dicomImageLoader.wadouri.loadImage(imageId)
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
