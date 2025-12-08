# Azure PACS DICOM v2 Integration Guide

This document describes the integration of Azure PACS (DICOM service) with the OHIF viewer, configured according to the Azure DICOM Conformance Statement v2.

## Overview

The integration has been updated to support Azure DICOM v2 API endpoints with proper authentication and API versioning. All data sources have been configured to use Azure DICOM v2 endpoints with the `/v2/` prefix as required by Azure.

## Configuration

### 1. Azure PACS Token Configuration

The Azure PACS token is configured globally in `platform/app/public/config/default.js`:

```javascript
// Azure PACS Token - Set your Azure DICOM service token here
const AZURE_PACS_TOKEN = 'YOUR_AZURE_DICOM_TOKEN_HERE';

// Azure DICOM Service Base URL
const AZURE_DICOM_SERVICE_URL = 'https://med-pacs-dev-dicomcloudwebapi-a3c3gxcmgzg4bchf.eastus-01.azurewebsites.net';
```

**Important:** Replace `'YOUR_AZURE_DICOM_TOKEN_HERE'` with your actual Azure DICOM service token.

The token is made globally accessible via `window.AZURE_PACS_TOKEN` and is automatically used in all API requests.

### 2. Azure DICOM v2 Base URL

The helper function `getAzureDicomV2BaseUrl()` automatically constructs the correct base URL with the `/v2/` prefix:

```javascript
function getAzureDicomV2BaseUrl() {
  const baseUrl = AZURE_DICOM_SERVICE_URL.replace(/\/v\d+\/?$/, '').replace(/\/$/, '');
  return `${baseUrl}/v2`;
}
```

This ensures all API calls use the correct Azure DICOM v2 endpoints:
- QIDO-RS: `https://<service_url>/v2/studies`
- WADO-RS: `https://<service_url>/v2/studies/{studyInstanceUID}/series/{seriesInstanceUID}/instances/{sopInstanceUID}`
- STOW-RS: `https://<service_url>/v2/studies`

## Updated Data Sources

The following data sources have been updated to use Azure DICOM v2:

1. **dicomweb** - Azure PACS DICOM v2 (default)
2. **localviewer-image-jpeg** - Azure PACS DICOM v2 (JPEG rendering)
3. **localviewer-application-dicom** - Azure PACS DICOM v2 (DICOM rendering)
4. **localviewer-raw-dicom** - Azure PACS DICOM v2 (Raw DICOM)
5. **demo** - Azure PACS DICOM v2 (Demo)

All data sources are configured with:
- `qidoRoot`: `${getAzureDicomV2BaseUrl()}` (dicomweb-client appends `/studies`)
- `wadoRoot`: `${getAzureDicomV2BaseUrl()}` (dicomweb-client appends paths)
- `qidoSupportsIncludeField: true` (Azure DICOM v2 supports includefield parameter)
- `supportsFuzzyMatching: true` (Azure DICOM v2 supports fuzzy matching for Person Name attributes)
- `supportsWildcard: true` (Azure DICOM v2 supports wildcard matching)
- `isAzureDicomV2: true` (Flag to identify Azure DICOM v2 configuration)
- `azureToken: AZURE_PACS_TOKEN` (Token stored in config for access)

## Authentication

### Global Token Usage

The Azure PACS token is used globally across all API requests through:

1. **DicomWebDataSource** (`extensions/default/src/DicomWebDataSource/index.ts`):
   - Checks for `isAzureDicomV2` flag and `azureToken` in configuration
   - Uses Bearer token authentication: `Authorization: Bearer ${azureToken}`

2. **User Authentication Service** (`platform/app/src/App.tsx`):
   - Checks for `window.AZURE_PACS_TOKEN` first (highest priority)
   - Falls back to cookie-based authentication if Azure token is not set

### Token Priority

The authentication system uses the following priority order:

1. **Azure PACS Token** (if configured and not placeholder)
2. **Demo Token** (if on demo route)
3. **Cookie Token** (from configured cookie name or common cookie names)

## API Endpoints

According to Azure DICOM Conformance Statement v2, the following endpoints are used:

### QIDO-RS (Query based on ID for DICOM Objects)

- **Search Studies**: `GET /v2/studies?{queryParameters}`
- **Search Series**: `GET /v2/studies/{studyInstanceUID}/series?{queryParameters}`
- **Search Instances**: `GET /v2/studies/{studyInstanceUID}/series/{seriesInstanceUID}/instances?{queryParameters}`

### WADO-RS (Web Access to DICOM Objects - RESTful)

- **Retrieve Study**: `GET /v2/studies/{studyInstanceUID}`
- **Retrieve Series**: `GET /v2/studies/{studyInstanceUID}/series/{seriesInstanceUID}`
- **Retrieve Instance**: `GET /v2/studies/{studyInstanceUID}/series/{seriesInstanceUID}/instances/{sopInstanceUID}`
- **Retrieve Frame**: `GET /v2/studies/{studyInstanceUID}/series/{seriesInstanceUID}/instances/{sopInstanceUID}/frames/{frameNumber}`

### STOW-RS (Store Over the Web - RESTful)

- **Store Instances**: `POST /v2/studies` or `PUT /v2/studies/{studyInstanceUID}`

## Query Parameters

Azure DICOM v2 supports the following query parameters (as per conformance statement):

### Supported Attributes

- `PatientName` - Supports fuzzy matching
- `PatientID` - Supports wildcard matching
- `AccessionNumber` - Supports wildcard matching
- `StudyDescription` - Supports wildcard matching
- `ModalitiesInStudy` - Exact match
- `StudyDate` - Range query (e.g., `20240101-20241231`)
- `StudyInstanceUID` - Exact match

### Query Options

- `includefield` - Specify additional attributes to return (comma-separated tag IDs or `all`)
- `limit` - Limit number of results (1-4000, default: 100)
- `offset` - Skip results for pagination
- `fuzzymatching` - Enable fuzzy matching for Person Name (PN) attributes (true/false)

## Response Format

Azure DICOM v2 returns responses in `application/dicom+json` format, which is automatically handled by the dicomweb-client library.

## Testing

To test the integration:

1. **Set your Azure token**: Update `AZURE_PACS_TOKEN` in `platform/app/public/config/default.js`
2. **Verify service URL**: Ensure `AZURE_DICOM_SERVICE_URL` points to your Azure DICOM service
3. **Test QIDO search**: Search for studies using the study list
4. **Test WADO retrieve**: Open a study and verify images load correctly

## Troubleshooting

### Token Not Working

- Verify the token is set correctly in `default.js`
- Check that the token is not the placeholder `'YOUR_AZURE_DICOM_TOKEN_HERE'`
- Ensure the token has proper permissions for the Azure DICOM service

### API Errors

- Verify the service URL is correct
- Check that the `/v2/` prefix is included in requests (check browser network tab)
- Ensure the token is being sent in the `Authorization` header

### Images Not Loading

- Verify WADO-RS endpoints are accessible
- Check that the instance UIDs are correct
- Ensure the transfer syntax is supported by Azure DICOM v2

## References

- [Azure DICOM Conformance Statement v2](https://learn.microsoft.com/en-us/azure/healthcare-apis/dicom/dicom-services-conformance-statement-v2)
- [Azure DICOM QIDO-RS Documentation](https://learn.microsoft.com/en-us/azure/healthcare-apis/dicom/dicom-services-conformance-statement-v2#search-qido-rs)
- [Azure DICOM WADO-RS Documentation](https://learn.microsoft.com/en-us/azure/healthcare-apis/dicom/dicom-services-conformance-statement-v2#retrieve-wado-rs)
