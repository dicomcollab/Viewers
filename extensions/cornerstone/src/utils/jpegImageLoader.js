import { imageLoader } from '@cornerstonejs/core';
import {
  isRedirectToRisOn401Enabled,
  resolveRis401RedirectUrlFromConfig,
} from './risRedirectConfig.js';

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

/**
 * Detect if an image is a color image (like fundus) vs grayscale (like X-ray)
 */
function detectColorImage(imageData, width, height) {
  const step = Math.max(1, Math.floor(Math.sqrt(width * height) / 50));
  let colorVariation = 0;
  let totalSamples = 0;
  let colorPixels = 0;

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

      if (variation > 20) {
        colorPixels++;
      }
    }
  }

  const avgColorVariation = totalSamples > 0 ? colorVariation / totalSamples : 0;
  const colorRatio = totalSamples > 0 ? colorPixels / totalSamples : 0;

  return avgColorVariation > 15 || colorRatio > 0.2;
}

/**
 * Process JPEG image and convert to Cornerstone format
 */
async function processJPEGImage(jpegBlob, imageId, jpegUrl, frameNumber, resolve, reject) {
  const img = new Image();

  img.onload = () => {
    try {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      canvas.width = img.width;
      canvas.height = img.height;
      ctx.drawImage(img, 0, 0);

      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

      // Debug: Check if we're getting actual image data
      console.log('Image Debug:', {
        width: imageData.width,
        height: imageData.height,
        first20Pixels: Array.from(imageData.data.slice(0, 20)),
        frameNumber: frameNumber,
      });

      let pixelData, color, rgba, photometricInterpretation, samplesPerPixel, sizeInBytes;

      // Detect if this is a color image
      const detectedAsColor = detectColorImage(imageData, canvas.width, canvas.height);

      // Check if this looks like a fundus image based on URL
      const isFundusByUrl =
        jpegUrl.toLowerCase().includes('fundus') ||
        jpegUrl.toLowerCase().includes('retina') ||
        jpegUrl.toLowerCase().includes('ophthalm') ||
        jpegUrl.toLowerCase().includes('eye');

      // Check if this looks like an echocardiogram (which has color Doppler)
      const isEchoByUrl =
        jpegUrl.toLowerCase().includes('echo') ||
        jpegUrl.toLowerCase().includes('cardiac') ||
        jpegUrl.toLowerCase().includes('heart') ||
        jpegUrl.toLowerCase().includes('ultrasound');

      // Force color for multi-frame images (echocardiograms are typically multi-frame and color)
      const isMultiFrame = frameNumber !== null && frameNumber !== undefined;
      const isColorImage = detectedAsColor || isFundusByUrl || isEchoByUrl || isMultiFrame;

      console.log('Color Detection Result:', {
        detectedAsColor: detectedAsColor,
        isFundusByUrl: isFundusByUrl,
        isEchoByUrl: isEchoByUrl,
        isMultiFrame: isMultiFrame,
        isColorImage: isColorImage,
        frameNumber: frameNumber,
      });

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
        planarConfiguration: 0,
        pixelRepresentation: 0,
      };

      // Mark this image as fully ready for UI loaders that rely on progress events.
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

function loadJPEGImage(imageId) {
  /** @type {any} */
  let xhr;
  const promise = new Promise((resolve, reject) => {
    try {
      // Before XHR send: show 0% so the viewport overlay appears as soon as loading starts.
      dispatchJPEGLoadProgress(imageId, 0, true);

      // Extract the original DICOM URL by removing the protocol prefix
      // Handle both 'dicomweb-jpeg:' and 'dicomweb:' prefixes
      let dicomUrl = imageId.replace('dicomweb-jpeg:', '').replace('dicomweb:', '');

      // Extract frame number from URL parameters
      const dicomUrlParams = new URLSearchParams(dicomUrl.split('?')[1] || '');
      const frameNumber = dicomUrlParams.get('frame');

      // Remove frame parameter from URL if present (we'll add it back if needed)
      const urlWithoutFrame = dicomUrl.split('&frame=')[0];

      // Ensure contentType is image/jpeg (replace if it's application/dicom)
      let jpegUrl = urlWithoutFrame.replace(
        'contentType=application/dicom',
        'contentType=image/jpeg'
      );

      // If contentType is not present, add it
      if (!jpegUrl.includes('contentType=')) {
        const separator = jpegUrl.includes('?') ? '&' : '?';
        jpegUrl = `${jpegUrl}${separator}contentType=image/jpeg`;
      }

      const token = getTokenFromCookie();

      // /external/viewer: same fixed Basic credential as DicomWebDataSource (JPEG XHR bypasses userAuthenticationService)
      const externalViewerBasic =
        typeof window !== 'undefined' &&
        window.getExternalViewerBasicToken &&
        typeof window.getExternalViewerBasicToken === 'function'
          ? window.getExternalViewerBasicToken()
          : null;

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

      // Share link (ShortCode): when URL has ShortCode and not expired, use Basic token for WADO-URI
      const shareLinkToken =
        typeof window !== 'undefined' &&
        window.getShareLinkBasicToken &&
        typeof window.getShareLinkBasicToken === 'function'
          ? window.getShareLinkBasicToken()
          : null;

      // Build authorization header
      let authHeader = '';
      if (externalViewerBasic) {
        authHeader = `Basic ${externalViewerBasic}`;
      } else if (isDemo && demoToken) {
        authHeader = `Basic ${demoToken}`;
      } else if (shareLinkToken) {
        authHeader = `Basic ${shareLinkToken}`;
      } else if (token) {
        authHeader = `Bearer ${token}`;
      }

      xhr = new XMLHttpRequest();
      xhr.open('GET', jpegUrl, true);
      xhr.responseType = 'blob';

      xhr.setRequestHeader('Accept', 'image/jpeg');
      xhr.setRequestHeader('Content-Type', 'image/jpeg');
      if (authHeader) {
        xhr.setRequestHeader('Authorization', authHeader);
      }

      // XHR download progress (reliable % while bytes stream; fetch often lacks this without workarounds)
      xhr.onprogress = event => {
        if (event.lengthComputable && event.total > 0) {
          dispatchJPEGLoadProgress(imageId, Math.min(1, event.loaded / event.total), true);
        }
      };

      xhr.onload = () => {
        try {
          if (xhr.status === 401) {
            handleJpegLoader401(xhr, reject);
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
          dispatchJPEGLoadProgress(imageId, 1, true);
          processJPEGImage(jpegBlob, imageId, jpegUrl, frameNumber, resolve, reject);
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
    } catch (error) {
      reject(new Error(`Failed to load JPEG image: ${error.message}`));
    }
  });

  return {
    promise: promise,
    cancel: () => {
      if (xhr && xhr.readyState !== 4) {
        xhr.abort();
      }
    },
  };
}

/**
 * Register the JPEG image loader with Cornerstone
 */
export function registerJPEGImageLoader() {
  try {
    // Register a custom image loader for JPEG images
    imageLoader.registerImageLoader('jpeg', loadJPEGImage);

    // Also register it for dicomweb-jpeg protocol to intercept JPEG requests
    imageLoader.registerImageLoader('dicomweb-jpeg', loadJPEGImage);

    // Note: We don't register for 'dicomweb' protocol as it would override the default loader
    // Instead, the wadouriTransform in getImageId.js will ensure URLs have contentType=image/jpeg
    // and the JPEG loader will be called via the 'dicomweb-jpeg' protocol or we can check in the loader itself
    console.log('JPEG Image Loader registered successfully');
  } catch (error) {
    console.error('Error registering JPEG Image Loader:', error);
  }
}
