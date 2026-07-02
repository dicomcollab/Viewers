type KeyImagesAuthConfig = {
  keyImagesAuthorization?: string;
};

function getCookie(name: string): string | null {
  if (typeof document === 'undefined' || !document.cookie) {
    return null;
  }
  const nameEQ = `${name}=`;
  const parts = document.cookie.split(';');
  for (let i = 0; i < parts.length; i++) {
    let c = parts[i].trim();
    if (c.indexOf(nameEQ) === 0) {
      try {
        return decodeURIComponent(c.substring(nameEQ.length).trim());
      } catch {
        return c.substring(nameEQ.length).trim();
      }
    }
  }
  return null;
}

function getSessionTokenFromBrowser(): string {
  const win = window as Window & {
    getViewerAccessBearerToken?: () => string | null;
  };
  const fromHelper =
    typeof win.getViewerAccessBearerToken === 'function' ? win.getViewerAccessBearerToken() : null;
  if (fromHelper?.trim()) {
    return fromHelper.trim();
  }
  return (
    getCookie('token') ||
    getCookie('patientToken') ||
    getCookie('accessToken') ||
    getCookie('authToken') ||
    getCookie('jwt') ||
    ''
  );
}

/**
 * Build auth headers for key-images upload (JWT session — no Basic credentials in client).
 */
export function getKeyImagesAuthHeader(
  config: KeyImagesAuthConfig | null | undefined
): Record<string, string> | undefined {
  const token = getSessionTokenFromBrowser();
  if (token) {
    return {
      token,
      Authorization: `Bearer ${token}`,
    };
  }

  const explicit = config?.keyImagesAuthorization?.trim();
  if (explicit) {
    const authorization = explicit.toLowerCase().startsWith('bearer ')
      ? explicit
      : `Bearer ${explicit}`;
    return { Authorization: authorization };
  }

  return undefined;
}
