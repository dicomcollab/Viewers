/**
 * Status 0 / aborted image loads happen when cine or paging cancels an in-flight
 * retrieve. They are not CORS/network failures — treating them as fatal blanks
 * the canvas and every later page stays empty.
 */
function isAbortedImageLoadError(error: unknown): boolean {
  if (error == null) {
    return false;
  }

  if (typeof error === 'object') {
    const record = error as Record<string, unknown>;
    const request = record.request as Record<string, unknown> | undefined;
    const status = record.status ?? record.statusCode ?? record.httpStatus ?? request?.status;

    if (status === 0 || status === '0') {
      return true;
    }

    if (record.name === 'AbortError' || request?.status === 0) {
      return true;
    }

    const message = String(record.message ?? '').toLowerCase();
    const cancelledWithoutStatus =
      status == null &&
      (message === '' ||
        message === 'undefined' ||
        message.includes('cannot convert undefined or null to object') ||
        message.includes('request failed') ||
        message.includes('abort'));

    if (cancelledWithoutStatus) {
      return true;
    }
  }

  const text = String(
    typeof error === 'object' && error
      ? (error as { message?: string }).message ?? error
      : error
  ).toLowerCase();

  return (
    text.includes('abort') ||
    text.includes('the user aborted') ||
    text.includes('failed to fetch') ||
    text.includes('networkerror when attempting to fetch') ||
    text.includes('cannot convert undefined or null to object')
  );
}

type HttpLoadFailure = Error & { status: number; request?: unknown; response?: unknown };

/**
 * Normalizes an image-load rejection into the dicomweb-client error shape the app's
 * httpErrorHandler expects. Returns null when the rejection carries no HTTP status:
 * loaders reject with the raw XHR, `{ error: xhr, dataSet }`, an Error, or nothing.
 */
function toHttpLoadFailure(error: unknown): HttpLoadFailure | null {
  if (error == null || typeof error !== 'object') {
    return null;
  }

  const record = error as Record<string, unknown>;
  const nested = record.error;
  const inner = (
    nested && typeof nested === 'object' && record.status == null ? nested : record
  ) as Record<string, unknown>;
  const request = (inner.request ??
    (typeof XMLHttpRequest !== 'undefined' && inner instanceof XMLHttpRequest
      ? inner
      : undefined)) as Record<string, unknown> | undefined;
  const status = Number(inner.status ?? inner.statusCode ?? inner.httpStatus ?? request?.status);

  if (!Number.isFinite(status) || status < 100) {
    return null;
  }

  const message = typeof inner.message === 'string' && inner.message ? inner.message : 'request failed';
  return Object.assign(new Error(message), {
    status,
    request,
    response: inner.response ?? request?.response,
  });
}

export { isAbortedImageLoadError, toHttpLoadFailure };
