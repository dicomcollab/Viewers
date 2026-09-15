const MISSING_INSTANCE_MESSAGE_PATTERNS = [
  'http 404',
  '404',
  'not found',
  'file not exist',
  'does not exist',
  'no such key',
  'nosuchkey',
  'instance not found',
  'object not found',
  'the specified key does not exist',
];

function getErrorStatus(error: Record<string, unknown>): number | string | undefined {
  const request = error.request as Record<string, unknown> | undefined;
  const response = error.response as Record<string, unknown> | undefined;

  return (
    error.status ??
    error.statusCode ??
    error.httpStatus ??
    request?.status ??
    response?.status
  );
}

function getErrorMessage(error: unknown): string {
  if (typeof error === 'string') {
    return error;
  }

  if (!error || typeof error !== 'object') {
    return String(error ?? '');
  }

  const record = error as Record<string, unknown>;
  const nestedError = record.error as Record<string, unknown> | undefined;
  const nestedDetail = record.detail as Record<string, unknown> | undefined;

  return String(
    record.message ?? nestedError?.message ?? nestedDetail?.message ?? record.toString?.() ?? ''
  );
}

/**
 * True when an instance/image load failed because the file is missing on the server
 * (e.g. metadata lists the instance but the PACS returns 404).
 */
export function isMissingInstanceLoadError(error: unknown): boolean {
  if (!error) {
    return false;
  }

  if (typeof error === 'object') {
    const status = getErrorStatus(error as Record<string, unknown>);
    if (status === 404 || status === '404') {
      return true;
    }
  }

  const message = getErrorMessage(error).toLowerCase();
  if (!message || message === '[object object]') {
    return false;
  }

  return MISSING_INSTANCE_MESSAGE_PATTERNS.some(pattern => message.includes(pattern));
}

/**
 * Benign viewer errors that should not surface as UI overlays or global error handlers.
 * Cine playback aborts in-flight frame retrieves (status 0 / undefined) — those are not CORS.
 */
export function shouldSuppressBenignViewerError(value: unknown): boolean {
  if (value == null) {
    return false;
  }

  const status =
    typeof value === 'object' ? getErrorStatus(value as Record<string, unknown>) : undefined;
  const message = getErrorMessage(value).toLowerCase();

  if (status === 0 || status === '0') {
    return true;
  }

  if (isMissingInstanceLoadError(value) || isMissingInstanceLoadError(message)) {
    return true;
  }

  if (
    message.includes('cannot convert undefined or null to object') ||
    message.includes('loading aborted') ||
    message.includes('request was aborted') ||
    message.includes('the user aborted') ||
    message.includes('failed to fetch') ||
    message.includes('isattributeused') ||
    message.includes('pixel data is missing') ||
    message.includes('the pixel data is missing') ||
    message.includes('http 406: not acceptable')
  ) {
    return true;
  }

  // dicomweb-client uses "request failed" for every reject; only swallow cancelled ones.
  if (message.includes('request failed') && (status == null || status === '')) {
    return true;
  }

  return false;
}
