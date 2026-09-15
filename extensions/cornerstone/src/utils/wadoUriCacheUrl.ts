/**
 * WADO-URI DICOM P10 files are one HTTP GET per SOP instance.
 * `&frame=N` / `frameNumber` only select a frame after the file is parsed —
 * they must not be part of the ArrayBuffer cache key, or every cine frame
 * re-downloads the whole instance and later frames never decode from the
 * already-fetched bytes.
 *
 * JPEG WADO-URI must NOT use this helper: each frame is its own still.
 */

function stripFrameQueryParams(url: string): string {
  return url
    .replace(/([?&])frameNumber=\d+/gi, '$1')
    .replace(/([?&])frame=\d+/gi, '$1')
    .replace(/&&+/g, '&')
    .replace(/\?&+/g, '?')
    .replace(/[?&]$/g, '');
}

function getWadoUriFileCacheUrl(url: string | null | undefined): string | null {
  if (!url || typeof url !== 'string') {
    return null;
  }

  return stripFrameQueryParams(url);
}

export { getWadoUriFileCacheUrl, stripFrameQueryParams };
