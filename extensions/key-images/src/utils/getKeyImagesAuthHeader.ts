type KeyImagesAuthConfig = {
  keyImagesAuthorization?: string;
  keyImagesBasicAuthToken?: string;
  keyImagesBasicAuth?: string;
  _demoToken?: string;
};

type WindowWithAuthHelpers = Window & {
  DEMO_TOKEN?: string;
  getExternalViewerBasicToken?: () => string | null;
  getDemoToken?: () => string | null;
};

function normalizeBasicAuthorization(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }
  return trimmed.toLowerCase().startsWith('basic ') ? trimmed : `Basic ${trimmed}`;
}

function encodeBasicCredentials(creds: string): string {
  try {
    return `Basic ${btoa(creds)}`;
  } catch {
    const bytes = new TextEncoder().encode(creds);
    let binary = '';
    bytes.forEach(b => (binary += String.fromCharCode(b)));
    return `Basic ${btoa(binary)}`;
  }
}

function resolvePreEncodedToken(config: KeyImagesAuthConfig): string {
  const fromConfig = config.keyImagesBasicAuthToken?.trim() || config._demoToken?.trim();
  if (fromConfig) {
    return fromConfig;
  }

  if (typeof window === 'undefined') {
    return '';
  }

  const win = window as WindowWithAuthHelpers;
  const fromWindow =
    win.DEMO_TOKEN?.trim() ||
    win.getExternalViewerBasicToken?.()?.trim() ||
    win.getDemoToken?.()?.trim() ||
    '';

  return fromWindow;
}

/**
 * Build Authorization header for key-images upload.
 * Uses pre-encoded base64 (DEMO_TOKEN pattern) — never re-encode unless only user:pass is configured.
 */
export function getKeyImagesAuthHeader(
  config: KeyImagesAuthConfig | null | undefined
): Record<string, string> | undefined {
  if (!config) {
    return undefined;
  }

  const explicit = config.keyImagesAuthorization?.trim();
  if (explicit) {
    const authorization = normalizeBasicAuthorization(explicit);
    return authorization ? { Authorization: authorization } : undefined;
  }

  const preEncoded = resolvePreEncodedToken(config);
  if (preEncoded) {
    return { Authorization: normalizeBasicAuthorization(preEncoded) };
  }

  const creds = config.keyImagesBasicAuth?.trim();
  if (creds && creds.includes(':')) {
    return { Authorization: encodeBasicCredentials(creds) };
  }

  return undefined;
}
