// ========== Azure PACS Token (single source of truth) ==========
// Set your token here or update window.AZURE_PACS_TOKEN / updateAzurePacsTokenEverywhere() at runtime.
// No OAuth/refresh – token is manually updated.
const AZURE_PACS_INITIAL_TOKEN = '';

// Cached token (mutable). Used everywhere.
let _cachedAzurePacsToken = AZURE_PACS_INITIAL_TOKEN;

// Get current Azure PACS token (always returns cached value).
function getAzurePacsToken() {
  return _cachedAzurePacsToken;
}

// Update token everywhere so all consumers (window, config) use the new value.
function updateAzurePacsTokenEverywhere(newToken) {
  if (!newToken || typeof newToken !== 'string') return;
  _cachedAzurePacsToken = newToken;
  if (typeof window !== 'undefined') {
    window.AZURE_PACS_TOKEN = newToken;
    if (window.config && window.config.dataSources) {
      window.config.dataSources.forEach(function (ds) {
        if (ds.configuration && 'azureToken' in ds.configuration) {
          ds.configuration.azureToken = newToken;
        }
      });
    }
  }
}

// Azure DICOM Service Base URL
const AZURE_DICOM_SERVICE_URL = 'https://hdsdemows-dicomdemo.dicom.azurehealthcareapis.com';

// Helper function to get Azure DICOM v2 base URL
function getAzureDicomV2BaseUrl() {
  const baseUrl = AZURE_DICOM_SERVICE_URL.replace(/\/v\d+\/?$/, '').replace(/\/$/, '');
  return `${baseUrl}/v2`;
}

// Expose token and helpers on window (no automatic refresh; token is set manually).
if (typeof window !== 'undefined') {
  window.AZURE_PACS_TOKEN = _cachedAzurePacsToken;
  window.getAzurePacsToken = getAzurePacsToken;
  window.updateAzurePacsTokenEverywhere = updateAzurePacsTokenEverywhere;
  window.getAzureDicomV2BaseUrl = getAzureDicomV2BaseUrl;
}

// ========== Frame retrieval data source options (Retrieve Frames Accept headers) ==========
// Each option maps to a supported Accept header for DICOM frame retrieval.
// Selectable in Settings > Preferences > Data Source. Transfer syntaxes supported for transcoding:
// 1.2.840.10008.1.2, 1.2.840.10008.1.2.1, 1.2.840.10008.1.2.2, 1.2.840.10008.1.2.4.50,
// 1.2.840.10008.1.2.4.57, 1.2.840.10008.1.2.4.70, 1.2.840.10008.1.2.4.90, 1.2.840.10008.1.2.4.91, 1.2.840.10008.1.2.5
var FRAME_RETRIEVAL_DATA_SOURCE_OPTIONS = [
  {
    sourceName: 'frame-multipart-octet-wildcard',
    friendlyName: 'Multipart octet-stream (transfer-syntax=*)',
    acceptHeader: ['multipart/related; type="application/octet-stream"; transfer-syntax=*'],
  },
  {
    sourceName: 'frame-multipart-octet-default',
    friendlyName: 'Multipart octet-stream (default 1.2.840.10008.1.2.1)',
    acceptHeader: ['multipart/related; type="application/octet-stream"; transfer-syntax=1.2.840.10008.1.2.1'],
  },
  {
    sourceName: 'frame-multipart-octet-explicit',
    friendlyName: 'Multipart octet-stream (Little Endian Explicit)',
    acceptHeader: ['multipart/related; type="application/octet-stream"; transfer-syntax=1.2.840.10008.1.2.1'],
  },
  {
    sourceName: 'frame-multipart-jp2-default',
    friendlyName: 'Multipart image/jp2 (default 1.2.840.10008.1.2.4.90)',
    acceptHeader: ['multipart/related; type="image/jp2"; transfer-syntax=1.2.840.10008.1.2.4.90'],
  },
  {
    sourceName: 'frame-multipart-jp2-90',
    friendlyName: 'Multipart image/jp2 (JPEG 2000 Lossless)',
    acceptHeader: ['multipart/related; type="image/jp2"; transfer-syntax=1.2.840.10008.1.2.4.90'],
  },
  {
    sourceName: 'frame-single-octet-wildcard',
    friendlyName: 'Single frame application/octet-stream (transfer-syntax=*)',
    acceptHeader: ['application/octet-stream; transfer-syntax=*'],
  },
  {
    sourceName: 'frame-any-default',
    friendlyName: 'Any (*/*, default application/octet-stream)',
    acceptHeader: ['*/*'],
  },
];

function getAzurePacsFrameRetrievalDataSources() {
  var baseUrl = getAzureDicomV2BaseUrl();
  var token = getAzurePacsToken();
  return FRAME_RETRIEVAL_DATA_SOURCE_OPTIONS.map(function (opt) {
    return {
      namespace: '@ohif/extension-default.dataSourcesModule.dicomweb',
      sourceName: opt.sourceName,
      configuration: {
        friendlyName: 'Azure PACS (Frame: ' + opt.friendlyName + ')',
        name: 'azure-pacs-v2-wadors',
        wadoUriRoot: baseUrl,
        qidoRoot: baseUrl,
        wadoRoot: baseUrl,
        qidoSupportsIncludeField: true,
        imageRendering: 'wadors',
        thumbnailRendering: 'wadors',
        enableStudyLazyLoad: true,
        supportsFuzzyMatching: true,
        supportsWildcard: true,
        staticWado: false,
        singlepart: 'bulkdata,video',
        bulkDataURI: {
          enabled: true,
          relativeResolution: 'studies',
          transform: function (url) {
            return url.replace('/pixeldata.mp4', '/rendered');
          },
        },
        omitQuotationForMultipartRequest: true,
        acceptHeader: opt.acceptHeader,
        isAzureDicomV2: true,
        azureToken: token,
      },
    };
  });
}

// Demo token - Set your basic token here for the demo datasource
// This will be sent as: Authorization: Basic YOUR_TOKEN
// Example: If token is "QjdYOVYzTFEyWlc4TTZSRkQwSjVQWVQ0S04xR0hTVTpCN1g5VjNMUTJaVzhNNlJGRDBKNVBZVDRLTjFHSFNV"
// It will be sent as: Authorization: Basic QjdYOVYzTFEyWlc4TTZSRkQwSjVQWVQ0S04xR0hTVTpCN1g5VjNMUTJaVzhNNlJGRDBKNVBZVDRLTjFHSFNV
const DEMO_TOKEN = 'QjdYOVYzTFEyWlc4TTZSRkQwSjVQWVQ0S04xR0hTVTpaNE0xSzlGOFFYN1RSRDVXMkxDVjBCSk42U0dZSFAz'; // Replace with your actual token (e.g., "QjdYOVYzTFEyWlc4TTZSRkQwSjVQWVQ0S04xR0hTVTpCN1g5VjNMUTJaVzhNNlJGRDBKNVBZVDRLTjFHSFNV")

// Demo study UID - Only this study will use the demo token
const DEMO_STUDY_UID = '1.2.392.200036.9116.2.6.1.48.1211393243.1750146394.000030';

// Helper function to check if we're on a demo route
function isDemoRoute() {
  if (typeof window === 'undefined' || !window.location) {
    return false;
  }
  const urlParams = new URLSearchParams(window.location.search);
  const studyUIDs = urlParams.get('StudyInstanceUIDs') || urlParams.get('studyInstanceUIDs');
  const path = window.location.pathname;
  // Only use demo token for the specific demo study UID on demo routes
  return studyUIDs === DEMO_STUDY_UID && (path.includes('/viewer/demo') || path.includes('/demo'));
}

// Function to get demo token if on demo route
function getDemoToken() {
  if (!isDemoRoute()) {
    return null;
  }
  if (DEMO_TOKEN && DEMO_TOKEN !== 'YOUR_DEMO_TOKEN_HERE') {
    return DEMO_TOKEN;
  }
  return null;
}

// Make demo token globally accessible for extensions
if (typeof window !== 'undefined') {
  // @ts-expect-error - Adding custom property to window
  window.DEMO_TOKEN = DEMO_TOKEN;
  // @ts-expect-error - Adding custom property to window
  window.DEMO_STUDY_UID = DEMO_STUDY_UID;
  window.isDemoRoute = isDemoRoute;
  window.getDemoToken = getDemoToken;
}

// Helper function to get token from cookie (using cookieUtils logic)
function getTokenFromCookie() {
  // Check for demo token first
  const demoToken = getDemoToken();
  if (demoToken) {
    return demoToken;
  }
  // Otherwise, get token from cookie using cookieUtils logic
  const name = 'token';
  const nameEQ = name + '=';
  const cookies = document.cookie.split(';');
  for (let i = 0; i < cookies.length; i++) {
    let cookie = cookies[i];
    while (cookie.charAt(0) === ' ') {
      cookie = cookie.substring(1, cookie.length);
    }
    if (cookie.indexOf(nameEQ) === 0) {
      return cookie.substring(nameEQ.length, cookie.length);
    }
  }
  return null;
}

// Function to fetch preferences from API
async function fetchPreferences() {
  try {
    const token = getTokenFromCookie();
    if (!token) {
      console.warn('No token found in cookie');
      return null;
    }
    const response = await fetch(
      `https://med-pacs-dev-risapi-win.azurewebsites.net/api/v1/preferences/getPreferences`,
      {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          Token: token,
        },
      }
    );
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Error fetching preferences:', error);
    return null;
  }
}

// Save preferences (e.g. data source selection) to API so it is used on next load
async function savePreferences(payload) {
  try {
    const token = getTokenFromCookie();
    if (!token) {
      console.warn('No token found in cookie');
      return { ok: false };
    }
    const response = await fetch(
      'https://med-pacs-dev-risapi-win.azurewebsites.net/api/v1/preferences/savePreferences',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Token: token,
        },
        body: JSON.stringify(payload || {}),
      }
    );
    if (!response.ok) {
      throw new Error('HTTP error! status: ' + response.status);
    }
    return { ok: true };
  } catch (error) {
    console.error('Error saving preferences:', error);
    return { ok: false };
  }
}

function getDefaultDataSourceName() {
  // Check localStorage first for cached value
  const cachedDataSource = localStorage.getItem('defaultDataSourceName');
  if (cachedDataSource) {
    console.log(`Using cached default data source: ${cachedDataSource}`);
    return cachedDataSource;
  }
  // Fallback to first frame retrieval option
  const defaultName = FRAME_RETRIEVAL_DATA_SOURCE_OPTIONS[0].sourceName;
  console.log(`Using fallback default data source: ${defaultName}`);
  return defaultName;
}

async function updateDefaultDataSourceName() {
  try {
    const preferences = await fetchPreferences();
    console.log('preferences', preferences.dataSourceFormat);
    if (preferences && preferences.dataSourceFormat) {
      const newDataSource = preferences.dataSourceFormat;
      console.log(`Updating default data source to: ${newDataSource}`);
      // Update localStorage cache
      localStorage.setItem('defaultDataSourceName', newDataSource);
      // Update config if it exists
      if (window['config']) {
        window['config'].defaultDataSourceName = newDataSource;
      }
      return newDataSource;
    }
  } catch (e) {
    console.log('Error fetching preferences:', e);
  }
  return null;
}

/** @type {AppTypes.Config} */
// @ts-expect-error - Adding custom property to window
window.config = {
  name: 'config/default.js',
  routerBasename: null,
  // whiteLabeling: {},
  extensions: [],
  modes: [],
  customizationService: {},
  showStudyList: true,
  // some windows systems have issues with more than 3 web workers
  maxNumberOfWebWorkers: 3,
  // below flag is for performance reasons, but it might not work for all servers
  showWarningMessageForCrossOrigin: true,
  showCPUFallbackMessage: true,
  showLoadingIndicator: true,
  experimentalStudyBrowserSort: false,
  strictZSpacingForVolumeViewport: true,
  groupEnabledModesFirst: true,
  allowMultiSelectExport: false,
  maxNumRequests: {
    interaction: 100,
    thumbnail: 75,
    // Prefetch number is dependent on the http protocol. For http 2 or
    // above, the number of requests can be go a lot higher.
    prefetch: 25,
  },
  showErrorDetails: 'always', // 'always', 'dev', 'production'
  // filterQueryParam: false,
  // Defines multi-monitor layouts
  multimonitor: [
    {
      id: 'split',
      test: ({ multimonitor }) => multimonitor === 'split',
      screens: [
        {
          id: 'ohif0',
          screen: null,
          location: {
            screen: 0,
            width: 0.5,
            height: 1,
            left: 0,
            top: 0,
          },
          options: 'location=no,menubar=no,scrollbars=no,status=no,titlebar=no',
        },
        {
          id: 'ohif1',
          screen: null,
          location: {
            width: 0.5,
            height: 1,
            left: 0.5,
            top: 0,
          },
          options: 'location=no,menubar=no,scrollbars=no,status=no,titlebar=no',
        },
      ],
    },

    {
      id: '2',
      test: ({ multimonitor }) => multimonitor === '2',
      screens: [
        {
          id: 'ohif0',
          screen: 0,
          location: {
            width: 1,
            height: 1,
            left: 0,
            top: 0,
          },
          options: 'fullscreen=yes,location=no,menubar=no,scrollbars=no,status=no,titlebar=no',
        },
        {
          id: 'ohif1',
          screen: 1,
          location: {
            width: 1,
            height: 1,
            left: 0,
            top: 0,
          },
          options: 'fullscreen=yes,location=no,menubar=no,scrollbars=no,status=no,titlebar=no',
        },
      ],
    },
  ],
  defaultDataSourceName: getDefaultDataSourceName(), // synchronous with localStorage cache
  // Options for Preferences > Data Source dropdown (frame retrieval sources only)
  dataSourceOptionsForPreferences: FRAME_RETRIEVAL_DATA_SOURCE_OPTIONS.map(function (opt) {
    return { value: opt.sourceName, label: opt.friendlyName };
  }),
  // Cookie-based authentication configuration
  // Set the cookie name that contains the authentication token
  // The token will be automatically read from cookies and passed in all API request headers
  cookieAuth: {
    enabled: true, // Set to false to disable cookie-based auth
    cookieName: 'token', // Name of the cookie containing the token (common names: 'token', 'accessToken', 'authToken', 'jwt')
  },
  // RIS Worklist redirect configuration
  // Set to false to disable redirecting root path (/) to RIS worklist
  redirectRootToRis: false, // Disabled - root path will show OHIF worklist instead of redirecting to RIS
  risWorklistUrl: 'https://synapse.med-pacs.com/worklist', // RIS worklist URL (not used when redirectRootToRis is false)
  /* Dynamic config allows user to pass "configUrl" query string this allows to load config without recompiling application. The regex will ensure valid configuration source */
  // dangerouslyUseDynamicConfig: {
  //   enabled: true,
  //   // regex will ensure valid configuration source and default is /.*/ which matches any character. To use this, setup your own regex to choose a specific source of configuration only.
  //   // Example 1, to allow numbers and letters in an absolute or sub-path only.
  //   // regex: /(0-9A-Za-z.]+)(\/[0-9A-Za-z.]+)*/
  //   // Example 2, to restricts to either hosptial.com or othersite.com.
  //   // regex: /(https:\/\/hospital.com(\/[0-9A-Za-z.]+)*)|(https:\/\/othersite.com(\/[0-9A-Za-z.]+)*)/
  //   regex: /.*/,
  // },
  dataSources: [
    {
      namespace: '@ohif/extension-default.dataSourcesModule.dicomweb',
      sourceName: 'ohif',
      configuration: {
        friendlyName: 'AWS S3 Static wado server',
        name: 'aws',
        wadoUriRoot: 'https://d14fa38qiwhyfd.cloudfront.net/dicomweb',
        qidoRoot: 'https://d14fa38qiwhyfd.cloudfront.net/dicomweb',
        wadoRoot: 'https://d14fa38qiwhyfd.cloudfront.net/dicomweb',
        qidoSupportsIncludeField: false,
        imageRendering: 'wadors',
        thumbnailRendering: 'wadors',
        enableStudyLazyLoad: true,
        supportsFuzzyMatching: true,
        supportsWildcard: false,
        staticWado: true,
        singlepart: 'bulkdata,video',
        // whether the data source should use retrieveBulkData to grab metadata,
        // and in case of relative path, what would it be relative to, options
        // are in the series level or study level (some servers like series some study)
        bulkDataURI: {
          enabled: true,
          relativeResolution: 'studies',
          transform: url => url.replace('/pixeldata.mp4', '/rendered'),
        },
        omitQuotationForMultipartRequest: true,
        // acceptHeader: 'multipart/related; type="image/jpeg"; transfer-syntax=*',
      },
    },

    {
      namespace: '@ohif/extension-default.dataSourcesModule.dicomweb',
      sourceName: 'ohif2',
      configuration: {
        friendlyName: 'AWS S3 Static wado secondary server',
        name: 'aws',
        wadoUriRoot: 'https://dd14fa38qiwhyfd.cloudfront.net/dicomweb',
        qidoRoot: 'https://dd14fa38qiwhyfd.cloudfront.net/dicomweb',
        wadoRoot: 'https://dd14fa38qiwhyfd.cloudfront.net/dicomweb',
        qidoSupportsIncludeField: false,
        supportsReject: false,
        imageRendering: 'wadors',
        thumbnailRendering: 'wadors',
        enableStudyLazyLoad: true,
        supportsFuzzyMatching: false,
        supportsWildcard: true,
        staticWado: true,
        singlepart: 'bulkdata,video',
        // whether the data source should use retrieveBulkData to grab metadata,
        // and in case of relative path, what would it be relative to, options
        // are in the series level or study level (some servers like series some study)
        bulkDataURI: {
          enabled: true,
          relativeResolution: 'studies',
        },
        omitQuotationForMultipartRequest: true,
      },
    },
    {
      namespace: '@ohif/extension-default.dataSourcesModule.dicomweb',
      sourceName: 'ohif3',
      configuration: {
        friendlyName: 'AWS S3 Static wado secondary server',
        name: 'aws',
        wadoUriRoot: 'https://d3t6nz73ql33tx.cloudfront.net/dicomweb',
        qidoRoot: 'https://d3t6nz73ql33tx.cloudfront.net/dicomweb',
        wadoRoot: 'https://d3t6nz73ql33tx.cloudfront.net/dicomweb',
        qidoSupportsIncludeField: false,
        supportsReject: false,
        imageRendering: 'wadors',
        thumbnailRendering: 'wadors',
        enableStudyLazyLoad: true,
        supportsFuzzyMatching: false,
        supportsWildcard: true,
        staticWado: true,
        singlepart: 'bulkdata,video',
        // whether the data source should use retrieveBulkData to grab metadata,
        // and in case of relative path, what would it be relative to, options
        // are in the series level or study level (some servers like series some study)
        bulkDataURI: {
          enabled: true,
          relativeResolution: 'studies',
        },
        omitQuotationForMultipartRequest: true,
      },
    },

    {
      namespace: '@ohif/extension-default.dataSourcesModule.dicomweb',
      sourceName: 'dicomweb',
      configuration: {
        friendlyName: 'Azure PACS DICOM v2',
        name: 'azure-pacs-v2',
        // Azure DICOM v2 requires /v2/ prefix in the URL
        // Format: https://<service_url>/v2/studies
        // Note: Azure DICOM v2 does NOT support WADO-URI, only WADO-RS
        // WADO-RS format: /v2/studies/{study}/series/{series}/instances/{instance}/frames/{frame}
        wadoUriRoot: `${getAzureDicomV2BaseUrl()}`,
        qidoRoot: `${getAzureDicomV2BaseUrl()}`,
        wadoRoot: `${getAzureDicomV2BaseUrl()}`,
        qidoSupportsIncludeField: true, // Azure DICOM v2 supports includefield parameter
        // Azure DICOM v2 only supports WADO-RS, not WADO-URI
        // WADO-RS retrieves instances as application/octet-stream
        imageRendering: 'wadors',
        thumbnailRendering: 'wadors',
        enableStudyLazyLoad: false,
        supportsFuzzyMatching: true, // Azure DICOM v2 supports fuzzy matching for Person Name (PN) attributes
        supportsWildcard: true, // Azure DICOM v2 supports wildcard matching
        staticWado: false, // Azure DICOM is not static WADO
        singlepart: 'bulkdata,video',
        // whether the data source should use retrieveBulkData to grab metadata,
        // and in case of relative path, what would it be relative to, options
        // are in the series level or study level (some servers like series some study)
        bulkDataURI: {
          enabled: true,
          relativeResolution: 'studies',
          transform: url => url.replace('/pixeldata.mp4', '/rendered'),
        },
        omitQuotationForMultipartRequest: false, // Set to false to include quotes in multipart/related header
        // For WADO-RS instance retrieval, use multipart/related with JP2 transfer syntax
        // Azure PACS supports: multipart/related; type="image/jp2";transfer-syntax=1.2.840.10008.1.2.4.90
        acceptHeader: ['multipart/related; type="image/jp2";transfer-syntax=1.2.840.10008.1.2.4.90'],
        // Alternative: Use requestTransferSyntaxUID to auto-generate the header
        // requestTransferSyntaxUID: '1.2.840.10008.1.2.4.90',
        // Azure DICOM v2 specific configuration
        // For QIDO-RS search endpoints, Azure DICOM v2 requires Accept: */*
        // This is set automatically in DicomWebDataSource for Azure DICOM v2
        isAzureDicomV2: true, // Flag to identify Azure DICOM v2
        azureToken: getAzurePacsToken(), // Store token in config for access
      },
    },

    // Frame retrieval data sources (configurable in Settings > Preferences > Data Source)
    ...getAzurePacsFrameRetrievalDataSources(),

    {
      namespace: '@ohif/extension-default.dataSourcesModule.dicomweb',
      sourceName: 'localviewer-image-jpeg',
      configuration: {
        friendlyName: 'Azure PACS DICOM v2 (WADO-RS)',
        name: 'azure-pacs-v2-wadors',
        // Azure DICOM v2 requires /v2/ prefix in the URL
        // Note: Azure DICOM v2 does NOT support WADO-URI, only WADO-RS
        // Use WADO-RS format: /v2/studies/{study}/series/{series}/instances/{instance}/frames/{frame}
        wadoUriRoot: `${getAzureDicomV2BaseUrl()}`,
        qidoRoot: `${getAzureDicomV2BaseUrl()}`,
        wadoRoot: `${getAzureDicomV2BaseUrl()}`,
        qidoSupportsIncludeField: true,
        // Azure DICOM v2 only supports WADO-RS, not WADO-URI
        // WADO-RS retrieves instances as application/octet-stream
        imageRendering: 'wadors',
        thumbnailRendering: 'wadors',
        enableStudyLazyLoad: true,
        supportsFuzzyMatching: true,
        supportsWildcard: true,
        staticWado: false,
        singlepart: 'bulkdata,video',
        bulkDataURI: {
          enabled: true,
          relativeResolution: 'studies',
          transform: url => url.replace('/pixeldata.mp4', '/rendered'),
        },
        omitQuotationForMultipartRequest: true,
        // For WADO-RS instance retrieval, use */*
        acceptHeader: '*/*',
        // Azure DICOM v2 specific configuration
        isAzureDicomV2: true,
        azureToken: getAzurePacsToken(),
      },
    },
    {
      namespace: '@ohif/extension-default.dataSourcesModule.dicomweb',
      sourceName: 'localviewer-application-dicom',
      configuration: {
        friendlyName: 'Azure PACS DICOM v2 (WADO-RS)',
        name: 'azure-pacs-v2-wadors',
        // Azure DICOM v2 requires /v2/ prefix in the URL
        // Note: Azure DICOM v2 does NOT support WADO-URI, only WADO-RS
        // Use WADO-RS format: /v2/studies/{study}/series/{series}/instances/{instance}/frames/{frame}
        wadoUriRoot: `${getAzureDicomV2BaseUrl()}`,
        qidoRoot: `${getAzureDicomV2BaseUrl()}`,
        wadoRoot: `${getAzureDicomV2BaseUrl()}`,
        qidoSupportsIncludeField: true,
        // Azure DICOM v2 only supports WADO-RS, not WADO-URI
        // WADO-RS retrieves instances as application/octet-stream
        imageRendering: 'wadors',
        thumbnailRendering: 'wadors',
        enableStudyLazyLoad: true,
        supportsFuzzyMatching: true,
        supportsWildcard: true,
        staticWado: false,
        singlepart: 'bulkdata,video',
        bulkDataURI: {
          enabled: true,
          relativeResolution: 'studies',
          transform: url => url.replace('/pixeldata.mp4', '/rendered'),
        },
        omitQuotationForMultipartRequest: true,
        // For WADO-RS instance retrieval, use */*
        acceptHeader: '*/*',
        // Azure DICOM v2 specific configuration
        isAzureDicomV2: true,
        azureToken: getAzurePacsToken(),
      },
    },
    {
      namespace: '@ohif/extension-default.dataSourcesModule.dicomweb',
      sourceName: 'localviewer-raw-dicom',
      configuration: {
        friendlyName: 'Azure PACS DICOM v2 (WADO-RS)',
        name: 'azure-pacs-v2-wadors',
        // Azure DICOM v2 requires /v2/ prefix in the URL
        // Note: Azure DICOM v2 does NOT support WADO-URI, only WADO-RS
        // WADO-RS format: /v2/studies/{study}/series/{series}/instances/{instance}/frames/{frame}
        wadoUriRoot: `${getAzureDicomV2BaseUrl()}`,
        qidoRoot: `${getAzureDicomV2BaseUrl()}`,
        wadoRoot: `${getAzureDicomV2BaseUrl()}`,
        qidoSupportsIncludeField: true,
        // Azure DICOM v2 only supports WADO-RS, not WADO-URI
        // WADO-RS retrieves instances as application/octet-stream
        imageRendering: 'wadors',
        thumbnailRendering: 'wadors',
        enableStudyLazyLoad: true,
        supportsFuzzyMatching: true,
        supportsWildcard: true,
        staticWado: false,
        singlepart: 'bulkdata,video',
        bulkDataURI: {
          enabled: true,
          relativeResolution: 'studies',
          transform: url => url.replace('/pixeldata.mp4', '/rendered'),
        },
        omitQuotationForMultipartRequest: true,
        // For WADO-RS instance retrieval, use */*
        acceptHeader: '*/*',
        // Azure DICOM v2 specific configuration
        isAzureDicomV2: true,
        azureToken: getAzurePacsToken(),
      },
    },
    {
      namespace: '@ohif/extension-default.dataSourcesModule.dicomweb',
      sourceName: 'local5000',
      configuration: {
        friendlyName: 'Static WADO Local Data',
        name: 'DCM4CHEE',
        qidoRoot: 'http://localhost:5000/dicomweb',
        wadoRoot: 'http://localhost:5000/dicomweb',
        qidoSupportsIncludeField: false,
        supportsReject: true,
        supportsStow: true,
        imageRendering: 'wadors',
        thumbnailRendering: 'wadors',
        enableStudyLazyLoad: true,
        supportsFuzzyMatching: false,
        supportsWildcard: true,
        staticWado: true,
        singlepart: 'video',
        bulkDataURI: {
          enabled: true,
          relativeResolution: 'studies',
        },
      },
    },
    {
      namespace: '@ohif/extension-default.dataSourcesModule.dicomweb',
      sourceName: 'demo',
      configuration: {
        friendlyName: 'Azure PACS DICOM v2 (Demo)',
        name: 'azure-pacs-v2-demo',
        // Azure DICOM v2 requires /v2/ prefix in the URL
        // Note: Azure DICOM v2 does NOT support WADO-URI, only WADO-RS
        // WADO-RS format: /v2/studies/{study}/series/{series}/instances/{instance}/frames/{frame}
        wadoUriRoot: `${getAzureDicomV2BaseUrl()}`,
        qidoRoot: `${getAzureDicomV2BaseUrl()}`,
        wadoRoot: `${getAzureDicomV2BaseUrl()}`,
        qidoSupportsIncludeField: true,
        // Azure DICOM v2 only supports WADO-RS, not WADO-URI
        // WADO-RS retrieves instances as application/octet-stream
        imageRendering: 'wadors',
        thumbnailRendering: 'wadors',
        enableStudyLazyLoad: true,
        supportsFuzzyMatching: true,
        supportsWildcard: true,
        staticWado: false,
        singlepart: 'bulkdata,video',
        bulkDataURI: {
          enabled: true,
          relativeResolution: 'studies',
          transform: url => url.replace('/pixeldata.mp4', '/rendered'),
        },
        omitQuotationForMultipartRequest: true,
        // For WADO-RS instance retrieval, use */*
        acceptHeader: '*/*',
        // Azure DICOM v2 specific configuration
        isAzureDicomV2: true,
        azureToken: getAzurePacsToken(),
        // Custom configuration to use hardcoded token
        onConfiguration: config => {
          // Store the demo token in the config so it can be accessed
          config._demoToken = DEMO_TOKEN;
          return config;
        },
        // Custom request options to inject the demo token
        requestOptions: {
          // This will be handled by the custom getAuthorizationHeader
        },
      },
    },
    {
      namespace: '@ohif/extension-default.dataSourcesModule.dicomweb',
      sourceName: 'orthanc',
      configuration: {
        friendlyName: 'local Orthanc DICOMWeb Server',
        name: 'DCM4CHEE',
        wadoUriRoot: 'http://localhost/pacs/dicom-web',
        qidoRoot: 'http://localhost/pacs/dicom-web',
        wadoRoot: 'http://localhost/pacs/dicom-web',
        qidoSupportsIncludeField: true,
        supportsReject: true,
        dicomUploadEnabled: true,
        imageRendering: 'wadors',
        thumbnailRendering: 'wadors',
        enableStudyLazyLoad: true,
        supportsFuzzyMatching: true,
        supportsWildcard: true,
        omitQuotationForMultipartRequest: true,
        bulkDataURI: {
          enabled: true,
          // This is an example config that can be used to fix the retrieve URL
          // where it has the wrong prefix (eg a canned prefix).  It is better to
          // just use the correct prefix out of the box, but that is sometimes hard
          // when URLs go through several systems.
          // Example URLS are:
          // "BulkDataURI" : "http://localhost/dicom-web/studies/1.2.276.0.7230010.3.1.2.2344313775.14992.1458058363.6979/series/1.2.276.0.7230010.3.1.3.1901948703.36080.1484835349.617/instances/1.2.276.0.7230010.3.1.4.1901948703.36080.1484835349.618/bulk/00420011",
          // when running on http://localhost:3003 with no server running on localhost.  This can be corrected to:
          // /orthanc/dicom-web/studies/1.2.276.0.7230010.3.1.2.2344313775.14992.1458058363.6979/series/1.2.276.0.7230010.3.1.3.1901948703.36080.1484835349.617/instances/1.2.276.0.7230010.3.1.4.1901948703.36080.1484835349.618/bulk/00420011
          // which is a valid relative URL, and will result in using the http://localhost:3003/orthanc/.... path
          // startsWith: 'http://localhost/',
          // prefixWith: '/orthanc/',
        },
      },
    },

    {
      namespace: '@ohif/extension-default.dataSourcesModule.dicomwebproxy',
      sourceName: 'dicomwebproxy',
      configuration: {
        friendlyName: 'dicomweb delegating proxy',
        name: 'dicomwebproxy',
      },
    },
    {
      namespace: '@ohif/extension-default.dataSourcesModule.dicomjson',
      sourceName: 'dicomjson',
      configuration: {
        friendlyName: 'dicom json',
        name: 'json',
      },
    },
    {
      namespace: '@ohif/extension-default.dataSourcesModule.dicomlocal',
      sourceName: 'dicomlocal',
      configuration: {
        friendlyName: 'dicom local',
      },
    },
  ],
  httpErrorHandler: error => {
    // This is 429 when rejected from the public idc sandbox too often.
    // @ts-expect-error - error may have status property
    console.warn(error.status);

    // Could use services manager here to bring up a dialog/modal if needed.
    console.warn('test, navigate to https://ohif.org/');
  },
  // segmentation: {
  //   segmentLabel: {
  //     enabledByDefault: true,
  //     labelColor: [255, 255, 0, 1], // must be an array
  //     hoverTimeout: 1,
  //     background: 'rgba(100, 100, 100, 0.5)', // can be any valid css color
  //   },
  // },
  // whiteLabeling: {
  //   createLogoComponentFn: function (React) {
  //     return React.createElement(
  //       'a',
  //       {
  //         target: '_self',
  //         rel: 'noopener noreferrer',
  //         className: 'text-purple-600 line-through',
  //         href: '_X___IDC__LOGO__LINK___Y_',
  //       },
  //       React.createElement('img', {
  //         src: './Logo.svg',
  //         className: 'w-14 h-14',
  //       })
  //     );
  //   },
  // },
};

// Expose preferences API for Settings UI
if (typeof window !== 'undefined') {
  window.fetchPreferences = fetchPreferences;
  window.savePreferences = savePreferences;
}

// Update defaultDataSourceName asynchronously and cache it
updateDefaultDataSourceName().catch(error => {
  console.error('Failed to update default data source name:', error);
});
