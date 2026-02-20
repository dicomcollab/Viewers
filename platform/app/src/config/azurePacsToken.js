/**
 * Azure PACS Token - Bridge to single source of truth (public/config/default.js)
 *
 * Token and refresh logic live in default.js. This file re-exports from window
 * so imports still work. Do not store token here; set AZURE_PACS_TOKEN_ENDPOINT
 * in default.js to enable hourly token refresh.
 */

const AZURE_DICOM_SERVICE_URL = 'https://hdsdemows-dicomdemo.dicom.azurehealthcareapis.com';

/** @returns {string} Current Azure PACS token (from default.js cache) */
export function getAzurePacsToken() {
  if (typeof window !== 'undefined' && window.getAzurePacsToken) {
    return window.getAzurePacsToken();
  }
  return (typeof window !== 'undefined' && window.AZURE_PACS_TOKEN) || '';
}

/** @returns {string} */
export function getAzureDicomServiceUrl() {
  return AZURE_DICOM_SERVICE_URL;
}

/** @returns {string} */
export function getAzureDicomV2BaseUrl() {
  const baseUrl = getAzureDicomServiceUrl();
  const cleanUrl = baseUrl.replace(/\/v\d+\/?$/, '').replace(/\/$/, '');
  return `${cleanUrl}/v2`;
}

// For backwards compatibility: export current token value (read from window when available)
export const AZURE_PACS_TOKEN = typeof window !== 'undefined' && window.getAzurePacsToken
  ? window.getAzurePacsToken()
  : (typeof window !== 'undefined' && window.AZURE_PACS_TOKEN) || '';
