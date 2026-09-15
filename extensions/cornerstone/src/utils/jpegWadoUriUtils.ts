/**
 * WADO-URI JPEG helpers.
 *
 * Multi-frame stacks use distinct Cornerstone imageIds (`&frame=N` or `/frames/N`).
 * The JPEG still must be fetched with that same frame, otherwise every cine
 * "frame" is the instance's default still and the picture never changes.
 */

function parseFrameNumberFromImageId(imageId: string | undefined | null): number | null {
  if (!imageId || typeof imageId !== 'string') {
    return null;
  }

  const query =
    imageId.match(/[?&]frameNumber=(\d+)/i) || imageId.match(/[?&]frame=(\d+)/i);
  if (query) {
    const frame = Number(query[1]);
    return Number.isFinite(frame) && frame > 0 ? frame : null;
  }

  const wadors = imageId.match(/\/frames\/(\d+)(?:[/?]|$)/i);
  if (wadors) {
    const frame = Number(wadors[1]);
    return Number.isFinite(frame) && frame > 0 ? frame : null;
  }

  return null;
}

function stripLoaderScheme(imageId: string): string {
  return imageId.replace(/^dicomweb-jpeg:/i, '').replace(/^dicomweb:/i, '');
}

/**
 * HTTP URL for a WADO-URI JPEG GET.
 * Keeps `&frame=N` from the imageId and also sends DICOM `frameNumber`.
 */
function buildJpegUrlFromImageId(imageId: string | undefined | null): string {
  const raw = String(imageId || '');
  let jpegUrl = stripLoaderScheme(raw).replace(
    'contentType=application/dicom',
    'contentType=image/jpeg'
  );

  if (!/contentType=/i.test(jpegUrl)) {
    jpegUrl += `${jpegUrl.includes('?') ? '&' : '?'}contentType=image/jpeg`;
  }

  const frame = parseFrameNumberFromImageId(raw);
  if (frame != null) {
    if (!/[?&]frame=\d+/i.test(jpegUrl)) {
      jpegUrl += `&frame=${frame}`;
    }
    if (!/[?&]frameNumber=\d+/i.test(jpegUrl)) {
      jpegUrl += `&frameNumber=${frame}`;
    }
  }

  return jpegUrl;
}

export { buildJpegUrlFromImageId, parseFrameNumberFromImageId };
