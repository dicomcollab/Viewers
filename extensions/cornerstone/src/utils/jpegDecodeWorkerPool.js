/**
 * Decode JPEG frames off the main thread: createImageBitmap + OffscreenCanvas in
 * a worker, color detection and RGBA → RGB / grayscale conversion included.
 *
 * The worker is built from an inline Blob so it works with any bundler. If the
 * browser lacks OffscreenCanvas, or a CSP blocks blob: workers, the pool disables
 * itself and callers fall back to main-thread decoding.
 */

import { isOutOfMemoryError } from './memoryPressure';

const WORKER_SOURCE = `
function detectColor(data, width, height) {
  var step = Math.max(1, Math.floor(Math.sqrt(width * height) / 50));
  var colorVariation = 0;
  var totalSamples = 0;
  var colorPixels = 0;
  var maxVariation = 0;

  for (var y = 0; y < height; y += step) {
    for (var x = 0; x < width; x += step) {
      var i = (y * width + x) * 4;
      if (i + 2 >= data.length) {
        continue;
      }
      var r = data[i];
      var g = data[i + 1];
      var b = data[i + 2];
      var variation = Math.max(r, g, b) - Math.min(r, g, b);
      totalSamples++;
      colorVariation += variation;
      if (variation > maxVariation) {
        maxVariation = variation;
      }
      if (variation > 12) {
        colorPixels++;
      }
    }
  }

  var avg = totalSamples > 0 ? colorVariation / totalSamples : 0;
  var ratio = totalSamples > 0 ? colorPixels / totalSamples : 0;
  return avg > 8 || ratio > 0.03 || maxVariation > 20;
}

// One canvas per worker: a new one per frame piles up native memory until GC.
var canvas = null;
var ctx = null;

function getCanvas(width, height) {
  if (!canvas) {
    canvas = new OffscreenCanvas(width, height);
    ctx = canvas.getContext('2d', { willReadFrequently: true });
  } else if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  } else {
    ctx.clearRect(0, 0, width, height);
  }
  return ctx;
}

self.onmessage = function (event) {
  var msg = event.data;

  createImageBitmap(msg.blob)
    .then(function (bitmap) {
      var width = bitmap.width;
      var height = bitmap.height;
      var ctx;
      try {
        ctx = getCanvas(width, height);
        ctx.drawImage(bitmap, 0, 0);
      } finally {
        bitmap.close();
      }

      var rgba = ctx.getImageData(0, 0, width, height).data;
      var color = msg.preColor || detectColor(rgba, width, height) || !msg.forceGrayscale;
      var pixelCount = width * height;
      var pixelData;
      var p;

      if (color) {
        pixelData = new Uint8Array(pixelCount * 3);
        for (p = 0; p < pixelCount; p++) {
          pixelData[p * 3] = rgba[p * 4];
          pixelData[p * 3 + 1] = rgba[p * 4 + 1];
          pixelData[p * 3 + 2] = rgba[p * 4 + 2];
        }
      } else {
        pixelData = new Uint8Array(pixelCount);
        for (p = 0; p < pixelCount; p++) {
          pixelData[p] = Math.round(
            0.299 * rgba[p * 4] + 0.587 * rgba[p * 4 + 1] + 0.114 * rgba[p * 4 + 2]
          );
        }
      }

      self.postMessage(
        { id: msg.id, width: width, height: height, color: color, pixelData: pixelData },
        [pixelData.buffer]
      );
    })
    .catch(function (error) {
      // Free the backing store; the next frame recreates it.
      canvas = null;
      ctx = null;
      self.postMessage({ id: msg.id, error: String((error && error.message) || error) });
    });
};
`;

const MAX_WORKERS = 2;
const DECODE_TIMEOUT_MS = 15000;

let workers = null;
let disabled = false;
let nextRequestId = 1;
let nextWorkerIndex = 0;
const pending = new Map();

function isSupported() {
  return (
    !disabled &&
    typeof Worker !== 'undefined' &&
    typeof OffscreenCanvas !== 'undefined' &&
    typeof createImageBitmap === 'function' &&
    typeof URL !== 'undefined' &&
    typeof URL.createObjectURL === 'function'
  );
}

function settle(id, settleFn) {
  const request = pending.get(id);

  if (!request) {
    return;
  }

  pending.delete(id);
  clearTimeout(request.timerId);
  settleFn(request);
}

function disablePool(reason) {
  disabled = true;
  workers?.forEach(worker => worker.terminate());
  workers = null;

  Array.from(pending.keys()).forEach(id => {
    settle(id, request => request.reject(new Error(reason)));
  });

  console.warn(`[jpegDecodeWorkerPool] Worker decoding disabled, using main thread: ${reason}`);
}

function onWorkerMessage(event) {
  const { id, error, width, height, color, pixelData } = event.data || {};

  settle(id, request => {
    if (error) {
      request.reject(new Error(error));
      return;
    }

    request.resolve({ width, height, color, pixelData });
  });
}

function getWorkers() {
  if (workers) {
    return workers;
  }

  // The blob URL is kept for the page lifetime: revoking it right after
  // new Worker() can race the worker script fetch in some browsers.
  const scriptUrl = URL.createObjectURL(
    new Blob([WORKER_SOURCE], { type: 'application/javascript' })
  );
  const count = Math.max(1, Math.min(MAX_WORKERS, (navigator.hardwareConcurrency || 2) - 1));

  workers = Array.from({ length: count }, () => {
    const worker = new Worker(scriptUrl);
    worker.onmessage = onWorkerMessage;
    worker.onerror = event => {
      event?.preventDefault?.();
      disablePool(event?.message || 'worker error');
    };
    return worker;
  });

  return workers;
}

/**
 * Resolves `{ width, height, color, pixelData }` (RGB or grayscale Uint8Array),
 * or `null` when worker decoding is unavailable or failed — caller then decodes
 * on the main thread. Rejects on out-of-memory: decoding again on the main
 * thread would only fail the same way and hold the UI thread.
 */
export function decodeJpegInWorker(blob, { preColor = false, forceGrayscale = false } = {}) {
  if (!isSupported()) {
    return Promise.resolve(null);
  }

  let pool;

  try {
    pool = getWorkers();
  } catch (error) {
    disablePool(error?.message || 'worker creation failed');
    return Promise.resolve(null);
  }

  const id = nextRequestId++;
  const worker = pool[nextWorkerIndex++ % pool.length];

  return new Promise((resolve, reject) => {
    const timerId = setTimeout(() => {
      settle(id, request => request.reject(new Error('worker decode timeout')));
    }, DECODE_TIMEOUT_MS);

    pending.set(id, { resolve, reject, timerId });

    try {
      worker.postMessage({ id, blob, preColor, forceGrayscale });
    } catch (error) {
      settle(id, request => request.reject(error));
    }
  }).catch(error => {
    if (isOutOfMemoryError(error)) {
      throw error;
    }
    return null;
  });
}
