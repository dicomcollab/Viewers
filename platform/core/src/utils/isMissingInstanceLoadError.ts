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
 */
export function shouldSuppressBenignViewerError(value: unknown): boolean {
  const text = String(value ?? '');
  if (!text || text === '[object Object]') {
    return false;
  }

  if (isMissingInstanceLoadError(text)) {
    return true;
  }

  return (
    text.includes('isAttributeUsed') ||
    text.includes('pixel data is missing') ||
    text.includes('The pixel data is missing') ||
    text.includes('request failed') ||
    text.includes('Cannot convert undefined or null to object') ||
    text.includes('loading aborted') ||
    text.includes('request was aborted') ||
    text.includes('HTTP 406: Not Acceptable')
  );
}
