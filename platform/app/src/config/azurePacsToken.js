/**
 * Azure PACS Token Configuration
 *
 * This file contains the global token for Azure DICOM service authentication.
 * The token should be set here and will be used across all API requests.
 *
 * IMPORTANT: Replace 'YOUR_AZURE_DICOM_TOKEN_HERE' with your actual Azure DICOM service token.
 */

// Azure PACS Token - Set your token here
// This token will be used globally for all Azure DICOM API requests
export const AZURE_PACS_TOKEN = 'eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiIsIng1dCI6InJ0c0ZULWItN0x1WTdEVlllU05LY0lKN1ZuYyIsImtpZCI6InJ0c0ZULWItN0x1WTdEVlllU05LY0lKN1ZuYyJ9.eyJhdWQiOiJodHRwczovL2RpY29tLmhlYWx0aGNhcmVhcGlzLmF6dXJlLmNvbSIsImlzcyI6Imh0dHBzOi8vc3RzLndpbmRvd3MubmV0LzhmNmE3ODg0LTA2ZjItNDJjMC05MzhhLWE3OTJmNWM1YTk1Zi8iLCJpYXQiOjE3NjUxODQ1NjAsIm5iZiI6MTc2NTE4NDU2MCwiZXhwIjoxNzY1MTg4Njc3LCJhY3IiOiIxIiwiYWlvIjoiQVVRQXUvOGFBQUFBU29KT2tmOGlsa3dwSkQydDJVd3ZMN240b1ErSzd3VjliMGt1dnB0Y1RtMVhianl3Q2hFU3VwSkRTNDZ1eEJFdUliWStFZFo0bzAwUVhmMTQ5K0tuVlE9PSIsImFtciI6WyJwd2QiLCJyc2EiXSwiYXBwaWQiOiIwNGIwNzc5NS04ZGRiLTQ2MWEtYmJlZS0wMmY5ZTFiZjdiNDYiLCJhcHBpZGFjciI6IjAiLCJkZXZpY2VpZCI6Ijk4ODYxMTQ4LTA0YmItNGU0NC1hYjdjLWFmOGQxOTU4ODM1NyIsImZhbWlseV9uYW1lIjoiQCBTb2Z0ZWNoIiwiZ2l2ZW5fbmFtZSI6IkRpY29tIiwiaWR0eXAiOiJ1c2VyIiwiaXBhZGRyIjoiMTA2LjIwMS4xNDYuMTg1IiwibmFtZSI6IkRpY29tIEAgU29mdGVjaCIsIm9pZCI6Ijg3M2Y5M2RlLTNhZjQtNDcyOC1hZDMzLTExYjRmZTQwNDEwNiIsInB1aWQiOiIxMDAzMjAwMzZENjg4OTFFIiwicHdkX3VybCI6Imh0dHBzOi8vZ28ubWljcm9zb2Z0LmNvbS9md2xpbmsvP2xpbmtpZD0yMjI0MTk4IiwicmgiOiIxLkFUMEFoSGhxal9JR3dFS1RpcWVTOWNXcFg3OGw1M1hPWnVwTW01cGNUS3JsZnpPaEFLWTlBQS4iLCJzY3AiOiJ1c2VyX2ltcGVyc29uYXRpb24iLCJzaWQiOiIwMGFiYjEzOS02MzEzLTZjOGMtNDM2MS00YzU5OGRlYWY0YjgiLCJzdWIiOiJ1bW5HNEZjUmJCN2wwVm9ibzJlelJWVkVwd3QyV0hDUHlqd0tlanZ2QS1JIiwidGlkIjoiOGY2YTc4ODQtMDZmMi00MmMwLTkzOGEtYTc5MmY1YzVhOTVmIiwidW5pcXVlX25hbWUiOiJkaWNvbUBjb2xsYWJzb2Z0ZWNoLmNvbS5hdSIsInVwbiI6ImRpY29tQGNvbGxhYnNvZnRlY2guY29tLmF1IiwidXRpIjoib2hWenBEd0J1a0M4dnoxcmthc1dBQSIsInZlciI6IjEuMCIsInhtc19hY3RfZmN0IjoiNSAzIiwieG1zX2Z0ZCI6IkowOTlEVk96QjNRVlg4NHQ0MkxkRDN5MC1yM01zcWVkYzlpVnowOVpsbTBCYTI5eVpXRmpaVzUwY21Gc0xXUnpiWE0iLCJ4bXNfaWRyZWwiOiI2IDEiLCJ4bXNfc3ViX2ZjdCI6IjMgNiJ9.M0KftPL9Kwr1X7jVZtZYmdndVfgijtb7uy16v9lAQN4sr4QRRlRx7bLONm2EIUzTbXoRDSaqCcRei56YZ_kVQ7vATrpCGOSW1uY5WAesQg32nEW7S3RXLfcWYrqisxv1-6o-pmBt7-H8C2o3XBg-K_WZXgkFa8CfydXtWdy8L_jd4qrpuazDok4XR9Wa76f0kZ-ZIsWuLnJQMSUCPM-7IZR5hKqOP7Yibzoo7u1Yd1aGgSe9mprSoJF7SSDFTOH01-WimqbWgxKckDG4v1QX9wsC9BTIb14SrdFvgeeGE36JToBbMVPfD3c4dQjgyjoC3WhY3SppQT51Y6zemWlaRw';

// Azure DICOM Service Base URL
// Replace with your Azure DICOM service URL (without /v2/ suffix)
// Example: 'https://your-dicom-service.dicom.azurehealthcareapis.com'
export const AZURE_DICOM_SERVICE_URL = 'https://hdsdemows-dicomdemo.dicom.azurehealthcareapis.com';

/**
 * Get the Azure PACS token
 * @returns {string} The Azure PACS token
 */
export function getAzurePacsToken() {
  return AZURE_PACS_TOKEN;
}

/**
 * Get the Azure DICOM service base URL
 * @returns {string} The base URL
 */
export function getAzureDicomServiceUrl() {
  return AZURE_DICOM_SERVICE_URL;
}

/**
 * Get the full Azure DICOM v2 API base URL
 * Azure DICOM v2 requires /v2/ prefix in the URL
 * @returns {string} The full base URL with /v2/ prefix
 */
export function getAzureDicomV2BaseUrl() {
  const baseUrl = getAzureDicomServiceUrl();
  // Ensure base URL doesn't end with /v2/ already
  const cleanUrl = baseUrl.replace(/\/v\d+\/?$/, '').replace(/\/$/, '');
  return `${cleanUrl}/v2`;
}

// Make token globally accessible
if (typeof window !== 'undefined') {
  window.AZURE_PACS_TOKEN = AZURE_PACS_TOKEN;
  window.getAzurePacsToken = getAzurePacsToken;
  window.getAzureDicomServiceUrl = getAzureDicomServiceUrl;
  window.getAzureDicomV2BaseUrl = getAzureDicomV2BaseUrl;
}
