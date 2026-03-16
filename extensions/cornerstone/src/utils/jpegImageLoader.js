import { imageLoader } from '@cornerstonejs/core';

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
function loadJPEGImage(imageId) {
  const promise = new Promise((resolve, reject) => {
    (async () => {
      try {
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

        // Build authorization header
        let authHeader = '';
        if (isDemo && demoToken) {
          // Use Basic auth for demo token
          authHeader = `Basic ${demoToken}`;
        } else if (token) {
          // Use Bearer token for regular requests
          authHeader = `Bearer ${token}`;
        }

        // Fetch JPEG image with proper headers
        const fetchHeaders = {
          'Content-Type': 'image/jpeg',
          Accept: 'image/jpeg',
        };

        if (authHeader) {
          fetchHeaders.Authorization = authHeader;
        }

        const jpegResponse = await fetch(jpegUrl, {
          headers: fetchHeaders,
        });

        // Handle 401 (Unauthorized) - token expired
        if (jpegResponse.status === 401) {
          // Try to get userAuthenticationService from global errorHandler
          const errorHandler = window.__OHIF_ERROR_HANDLER__;
          if (errorHandler && errorHandler._servicesManager) {
            const userAuthenticationService = errorHandler._servicesManager?.services?.userAuthenticationService;
            if (userAuthenticationService && typeof userAuthenticationService.handleUnauthenticated === 'function') {
              userAuthenticationService.handleUnauthenticated();
              return; // Don't reject, just redirect
            }
          }

          // Fallback: redirect to RIS URL
          const appConfig = window.config || {};
          const risWorklistUrl = appConfig.risWorklistUrl || 'https://synapse.med-pacs.com/login';
          console.log('401 error in JPEG loader - redirecting to RIS:', risWorklistUrl);
          window.location.href = risWorklistUrl;
          return; // Don't reject, just redirect
        }

        if (!jpegResponse.ok) {
          throw new Error(`HTTP ${jpegResponse.status}: ${jpegResponse.statusText}`);
        }

        const jpegBlob = await jpegResponse.blob();

        // Process the JPEG image
        await processJPEGImage(jpegBlob, imageId, jpegUrl, frameNumber, resolve, reject);
      } catch (error) {
        // Check if error is 401 related
        if (error.message && error.message.includes('401')) {
          // Try to get userAuthenticationService from global errorHandler
          const errorHandler = window.__OHIF_ERROR_HANDLER__;
          if (errorHandler && errorHandler._servicesManager) {
            const userAuthenticationService = errorHandler._servicesManager?.services?.userAuthenticationService;
            if (userAuthenticationService && typeof userAuthenticationService.handleUnauthenticated === 'function') {
              userAuthenticationService.handleUnauthenticated();
              return; // Don't reject, just redirect
            }
          }

          // Fallback: redirect to RIS URL
          const appConfig = window.config || {};
          const risWorklistUrl = appConfig.risWorklistUrl || 'https://synapse.med-pacs.com/worklist';
          console.log('401 error in JPEG loader catch - redirecting to RIS:', risWorklistUrl);
          window.location.href = risWorklistUrl;
          return; // Don't reject, just redirect
        }

        reject(new Error(`Failed to load JPEG image: ${error.message}`));
      }
    })();
  });

  return {
    promise: promise,
    cancel: () => {
      // Add cancellation logic if needed
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
