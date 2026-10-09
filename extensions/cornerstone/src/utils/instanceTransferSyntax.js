import { imageLoader, metaData } from '@cornerstonejs/core';
import dicomImageLoader from '@cornerstonejs/dicom-image-loader';
import {
  getPersistentCachedArrayBuffer,
  setPersistentCachedImage,
  toPersistentImageCacheKey,
} from './persistentImageCache';
import { getImageRequestGeneration } from './imageRequestSession';

/**
 * WADO-RS in the instance's stored (original) transfer syntax.
 *
 * The PACS keeps the original compressed upload (RLE, JPEG, …) next to the
 * decompressed copies. Asked with
 *   Accept: multipart/related; type=application/dicom; transfer-syntax=<(0002,0010)>
 * it answers with the whole instance as a DICOM file in that syntax. The file is
 * downloaded once per instance, parsed, and every frame is decoded from it in the
 * image-loader workers. Any failure falls back to the regular frame request.
 *
 * Data source config:
 *   instanceTransferSyntax: {
 *     enabled: true,
 *     acceptType: 'application/dicom',   // `type=` sent in the Accept header
 *     instancePath: '/frames/1',         // appended to .../instances/{sop} for the file request
 *     transferSyntaxes: [...],           // optional allow-list (defaults below)
 *     modalities: ['US'],                // optional, all modalities when omitted
 *   }
 */

/**
 * Compressed syntaxes the dicom-image-loader decode worker supports.
 * Uncompressed instances (1.2.840.10008.1.2, .1.2.1, .1.2.2) are left out on purpose:
 * their transfer-syntax=* frames are already the stored pixels, fetched one frame at a
 * time, while this path downloads and holds the whole uncompressed file (hundreds of MB
 * for a long clip). Add them through `transferSyntaxes` to force the file download.
 */
const DEFAULT_TRANSFER_SYNTAXES = [
  '1.2.840.10008.1.2.5', // RLE Lossless
  '1.2.840.10008.1.2.4.50', // JPEG Baseline
  '1.2.840.10008.1.2.4.51', // JPEG Extended
  '1.2.840.10008.1.2.4.57', // JPEG Lossless
  '1.2.840.10008.1.2.4.70', // JPEG Lossless SV1
  '1.2.840.10008.1.2.4.80', // JPEG-LS Lossless
  '1.2.840.10008.1.2.4.81', // JPEG-LS Near-lossless
  '1.2.840.10008.1.2.4.90', // JPEG 2000 Lossless
  '1.2.840.10008.1.2.4.91', // JPEG 2000
  '1.2.840.10008.1.2.4.201', // HTJ2K Lossless
  '1.2.840.10008.1.2.4.202', // HTJ2K Lossless RPCL
  '1.2.840.10008.1.2.4.203', // HTJ2K
];

const DEFAULT_INSTANCE_PATH = '/frames/1';
/** After this many instances fail for one syntax, stop requesting it at all. */
const SYNTAX_DISABLE_AFTER_FAILURES = 3;
/** xhrRequest params key read by beforeSend to set the Accept header. */
const ACCEPT_PARAM = 'ohifOriginalSyntaxAccept';

const fallbackInstances = new Set();
const failuresBySyntax = new Map();
const disabledSyntaxes = new Set();
const warned = new Set();

function warnOnce(key, ...args) {
  if (warned.has(key)) {
    return;
  }
  warned.add(key);
  console.warn('[instanceTransferSyntax]', ...args);
}

function firstValue(value) {
  return Array.isArray(value) ? value[0] : value;
}

/** Frames of one instance share a key: the WADO-RS URL up to `/frames/`. */
function getInstanceKey(imageId) {
  const url = imageId.replace(/^wadors:/i, '');
  const framesAt = url.indexOf('/frames/');
  return framesAt === -1 ? url : url.slice(0, framesAt);
}

function getFrameIndex(imageId) {
  const match = /\/frames\/(\d+)/i.exec(imageId);
  return match ? Math.max(0, parseInt(match[1], 10) - 1) : 0;
}

function getInstanceMetadata(imageId) {
  try {
    return metaData.get('instance', imageId) || null;
  } catch {
    return null;
  }
}

/**
 * Original-syntax request for this frame's instance, or null to use the data
 * source default (transfer-syntax=*).
 */
function getOriginalSyntaxRequest(sourceConfig, imageId) {
  const config = sourceConfig?.instanceTransferSyntax;

  if (!config?.enabled || typeof imageId !== 'string' || !/^wadors:/i.test(imageId)) {
    return null;
  }

  const instanceKey = getInstanceKey(imageId);

  if (fallbackInstances.has(instanceKey)) {
    return null;
  }

  const instance = getInstanceMetadata(imageId);
  const transferSyntaxUID = String(
    firstValue(instance?.TransferSyntaxUID ?? instance?.AvailableTransferSyntaxUID) ?? ''
  ).trim();

  if (!transferSyntaxUID || disabledSyntaxes.has(transferSyntaxUID)) {
    return null;
  }

  const allowed = Array.isArray(config.transferSyntaxes)
    ? config.transferSyntaxes
    : DEFAULT_TRANSFER_SYNTAXES;

  if (!allowed.includes(transferSyntaxUID)) {
    return null;
  }

  if (Array.isArray(config.modalities) && config.modalities.length) {
    const modality = firstValue(instance?.Modality);
    if (!config.modalities.includes(modality)) {
      return null;
    }
  }

  const acceptType = config.acceptType || 'application/dicom';

  return {
    accept: `multipart/related; type=${acceptType}; transfer-syntax=${transferSyntaxUID}`,
    transferSyntaxUID,
    instanceKey,
    fileUrl: `${instanceKey}${config.instancePath ?? DEFAULT_INSTANCE_PATH}`,
  };
}

function markInstanceFallback({ instanceKey, transferSyntaxUID }, reason) {
  if (!instanceKey || fallbackInstances.has(instanceKey)) {
    return;
  }

  fallbackInstances.add(instanceKey);

  const failures = (failuresBySyntax.get(transferSyntaxUID) ?? 0) + 1;
  failuresBySyntax.set(transferSyntaxUID, failures);

  if (failures >= SYNTAX_DISABLE_AFTER_FAILURES) {
    disabledSyntaxes.add(transferSyntaxUID);
  }

  warnOnce(
    `${transferSyntaxUID}|${reason}`,
    `Original transfer syntax ${transferSyntaxUID} not usable (${reason}); ` +
      'falling back to the default transfer syntax for affected instances.'
  );
}

/** `window.XMLHttpRequest` is wrapped by the image loader, so `instanceof` cannot be used. */
function getFailedXhr(reason) {
  const error = reason?.error ?? reason;
  return error && typeof error === 'object' && 'readyState' in error && typeof error.status === 'number'
    ? error
    : null;
}

/** Aborted, timed out or dropped: says nothing about whether the PACS serves the syntax. */
function isTransportFailure(reason) {
  return getFailedXhr(reason)?.status === 0;
}

function describeFailure(reason) {
  const xhr = getFailedXhr(reason);
  if (xhr) {
    return `HTTP ${xhr.status}`;
  }
  const error = reason?.error ?? reason;
  return error?.message || String(error);
}

function indexOfCrlfCrlf(bytes, limit) {
  const end = Math.min(bytes.length - 3, limit);
  for (let i = 0; i < end; i += 1) {
    if (bytes[i] === 13 && bytes[i + 1] === 10 && bytes[i + 2] === 13 && bytes[i + 3] === 10) {
      return i;
    }
  }
  return -1;
}

function lastIndexOfBytes(bytes, pattern, minIndex) {
  for (let i = bytes.length - pattern.length; i >= minIndex; i -= 1) {
    let match = true;
    for (let j = 0; j < pattern.length; j += 1) {
      if (bytes[i + j] !== pattern[j]) {
        match = false;
        break;
      }
    }
    if (match) {
      return i;
    }
  }
  return -1;
}

function latin1Decode(bytes) {
  let text = '';
  for (let i = 0; i < bytes.length; i += 1) {
    text += String.fromCharCode(bytes[i]);
  }
  return text;
}

function latin1Encode(text) {
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) {
    bytes[i] = text.charCodeAt(i) & 0xff;
  }
  return bytes;
}

function isDicomPart10(bytes, offset) {
  return (
    bytes.length > offset + 132 &&
    bytes[offset + 128] === 0x44 && // D
    bytes[offset + 129] === 0x49 && // I
    bytes[offset + 130] === 0x43 && // C
    bytes[offset + 131] === 0x4d // M
  );
}

/** The DICOM file inside a single-part multipart response (or the raw body), else null. */
function extractDicomPart10(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);

  if (isDicomPart10(bytes, 0)) {
    return arrayBuffer;
  }

  const headerEnd = indexOfCrlfCrlf(bytes, 4096);
  if (headerEnd === -1 || !isDicomPart10(bytes, headerEnd + 4)) {
    return null;
  }

  const offset = headerEnd + 4;
  const boundary = latin1Decode(bytes.subarray(0, headerEnd))
    .split('\r\n')
    .find(line => line.startsWith('--'));
  const end = boundary ? lastIndexOfBytes(bytes, latin1Encode(`\r\n${boundary}`), offset) : -1;

  return arrayBuffer.slice(offset, end === -1 ? bytes.length : end);
}

function createInstanceFileRequest(request) {
  const { fileUrl, accept, transferSyntaxUID } = request;
  const separator = fileUrl.includes('?') ? '&' : '?';
  const cacheKey = toPersistentImageCacheKey(
    `${fileUrl}${separator}ohifTransferSyntax=${transferSyntaxUID}`
  );

  return async (_uri, imageId) => {
    const cached = await getPersistentCachedArrayBuffer(cacheKey);

    if (cached) {
      // Viewport download overlays finish on this event; a cache hit has no XHR.
      window.dispatchEvent(
        new CustomEvent('ohif:dicom-loader-xhr', {
          detail: { phase: 'end', imageId, url: fileUrl },
        })
      );
      return cached;
    }

    const response = await dicomImageLoader.internal.xhrRequest(
      fileUrl,
      imageId,
      { Accept: accept },
      { [ACCEPT_PARAM]: accept }
    );
    const part10 = response instanceof ArrayBuffer ? extractDicomPart10(response) : null;

    if (!part10) {
      throw new Error('response is not a DICOM file');
    }

    void setPersistentCachedImage(cacheKey, part10);
    return part10;
  };
}

function loadFrameFromOriginalInstance(imageId, options, request, fallbackLoader) {
  const { dataSetCacheManager, loadImageFromPromise } = dicomImageLoader.wadouri;
  const frameIndex = getFrameIndex(imageId);
  const dataSetKey = `${request.fileUrl}#transfer-syntax=${request.transferSyntaxUID}`;

  const dataSetPromise = dataSetCacheManager
    .load(dataSetKey, createInstanceFileRequest(request), imageId)
    .then(dataSet => {
      const numberOfFrames = dataSet.intString('x00280008') || 1;
      if (frameIndex >= numberOfFrames) {
        throw new Error(`file has ${numberOfFrames} frame(s), frame ${frameIndex + 1} requested`);
      }
      return dataSet;
    });

  const loadOptions = { ...options };
  delete loadOptions.loader;

  const imageLoadObject = loadImageFromPromise(
    dataSetPromise,
    imageId,
    frameIndex,
    dataSetKey,
    loadOptions
  );

  const generation = getImageRequestGeneration();
  let released = false;

  const promise = imageLoadObject.promise.catch(reason => {
    released = true;
    dataSetCacheManager.unload(dataSetKey);
    // Study switched, or the download was cut: fail this frame; the next request retries.
    if (generation !== getImageRequestGeneration() || isTransportFailure(reason)) {
      throw reason;
    }
    markInstanceFallback(request, describeFailure(reason));
    return fallbackLoader(imageId, options).promise;
  });

  return {
    promise,
    cancelFn: undefined,
    decache: () => {
      if (!released) {
        dataSetCacheManager.unload(dataSetKey);
      }
    },
  };
}

/**
 * Route `wadors:` frames of instances stored in a compressed syntax through the
 * whole-instance original-syntax download. Must run after dicomImageLoader.init().
 */
function registerOriginalSyntaxWadorsLoader(getSourceConfig) {
  const wadorsLoader = dicomImageLoader?.wadors?.loadImage;

  if (typeof wadorsLoader !== 'function' || !dicomImageLoader?.wadouri?.dataSetCacheManager) {
    return;
  }

  imageLoader.registerImageLoader('wadors', (imageId, options = {}) => {
    let request = null;
    try {
      request = getOriginalSyntaxRequest(getSourceConfig(), imageId);
    } catch {
      request = null;
    }

    return request
      ? loadFrameFromOriginalInstance(imageId, options, request, wadorsLoader)
      : wadorsLoader(imageId, options);
  });
}

/** Accept header for the original-syntax file request (from xhrRequest params), if any. */
function getOriginalSyntaxAcceptFromParams(params) {
  return params?.[ACCEPT_PARAM] || null;
}

/** Study switch: failures of the previous study must not send the next one to transfer-syntax=*. */
function resetOriginalSyntaxState() {
  fallbackInstances.clear();
  failuresBySyntax.clear();
  disabledSyntaxes.clear();
  warned.clear();
}

export {
  DEFAULT_TRANSFER_SYNTAXES,
  getOriginalSyntaxAcceptFromParams,
  getOriginalSyntaxRequest,
  registerOriginalSyntaxWadorsLoader,
  resetOriginalSyntaxState,
};
