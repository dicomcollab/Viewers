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

// Shared cache: one in-flight promise and resolved result so getPreferences is called only once per session
let _preferencesPromise = null;
let _preferencesCache = undefined;

// Function to fetch preferences from API (single call per session, shared across app)
async function fetchPreferences() {
  if (_preferencesCache !== undefined) {
    return _preferencesCache;
  }
  if (_preferencesPromise) {
    return _preferencesPromise;
  }
  _preferencesPromise = (async () => {
    try {
      const token = getTokenFromCookie();
      if (!token) {
        console.warn('No token found in cookie');
        return null;
      }
      const response = await fetch(
        `https://med-pacs-dev-risapi-fgb0frguhuaqgrfs.eastus-01.azurewebsites.net/api/v1/preferences/getPreferences`,
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
      _preferencesCache = data;
      return data;
    } catch (error) {
      console.error('Error fetching preferences:', error);
      _preferencesCache = null;
      return null;
    } finally {
      _preferencesPromise = null;
    }
  })();
  return _preferencesPromise;
}

// Optional: clear cache (e.g. after save so next read gets fresh data)
function clearPreferencesCache() {
  _preferencesPromise = null;
  _preferencesCache = undefined;
}

async function savePreferences(payload) {
  try {
    const token = getTokenFromCookie();
    if (!token) {
      console.warn('No token found in cookie');
      return null;
    }
    const response = await fetch(
      `https://med-pacs-dev-risapi-fgb0frguhuaqgrfs.eastus-01.azurewebsites.net/api/v1/preferences/savePreferences`,
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
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    clearPreferencesCache();
    return await response.json();
  } catch (error) {
    console.error('Error saving preferences:', error);
    return null;
  }
}

function getDefaultDataSourceName() {
  // Check localStorage first for cached value
  const cachedDataSource = localStorage.getItem('defaultDataSourceName');
  if (cachedDataSource) {
    console.log(`Using cached default data source: ${cachedDataSource}`);
    return cachedDataSource;
  }
  // Fallback to default
  const defaultName = 'localviewer-image-jpeg';
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
  // Load only first series metadata on init; load other series when user clicks (requires enableStudyLazyLoad on data source).
  loadSeriesMetadataOnDemand: true,
  // When loadSeriesMetadataOnDemand is true, load this many series in background so thumbnails appear (0 = none).
  loadSeriesMetadataOnDemandBackgroundCount: 5,
  studyPrefetcher: {
    enabled: true,
    maxNumPrefetchRequests: 3,
    maxImagesPerDisplaySetToPrefetch: 30, // Cap prefetch per series to reduce API calls (e.g. 464-instance series)
    prefetchAllSeries: false,
  },
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
  // Cookie-based authentication configuration
  // Set the cookie name that contains the authentication token
  // The token will be automatically read from cookies and passed in all API request headers
  cookieAuth: {
    enabled: true, // Set to false to disable cookie-based auth
    cookieName: 'token', // Name of the cookie containing the token (common names: 'token', 'accessToken', 'authToken', 'jwt')
  },
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
        friendlyName: 'AWS S3 Static wado server',
        name: 'aws',
        wadoUriRoot:
          'https://med-pacs-dev-dicomcloudwebapi-linux-cyhzgxbbb5hqcgby.eastus-01.azurewebsites.net/api',
        qidoRoot:
          'https://med-pacs-dev-dicomcloudwebapi-linux-cyhzgxbbb5hqcgby.eastus-01.azurewebsites.net/api',
        wadoRoot:
          'https://med-pacs-dev-dicomcloudwebapi-linux-cyhzgxbbb5hqcgby.eastus-01.azurewebsites.net/api',
        qidoSupportsIncludeField: false,
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
          transform: url => url.replace('/pixeldata.mp4', '/rendered'),
        },
        omitQuotationForMultipartRequest: true,
      },
    },

    {
      namespace: '@ohif/extension-default.dataSourcesModule.dicomweb',
      sourceName: 'localviewer-image-jpeg',
      configuration: {
        friendlyName: 'AWS S3 Static wado server',
        name: 'aws',
        wadoUriRoot:
          'https://med-pacs-dev-dicomcloudwebapi-linux-cyhzgxbbb5hqcgby.eastus-01.azurewebsites.net/wadouri',
        qidoRoot:
          'https://med-pacs-dev-dicomcloudwebapi-linux-cyhzgxbbb5hqcgby.eastus-01.azurewebsites.net/api',
        wadoRoot:
          'https://med-pacs-dev-dicomcloudwebapi-linux-cyhzgxbbb5hqcgby.eastus-01.azurewebsites.net/api',
        qidoSupportsIncludeField: true,
        imageRendering: 'wadouri',
        thumbnailRendering: 'wadouri',
        enableStudyLazyLoad: true,
        supportsFuzzyMatching: false,
        supportsWildcard: true,
        staticWado: true,
        singlepart: 'bulkdata,video',
        bulkDataURI: {
          enabled: true,
          relativeResolution: 'studies',
          transform: url => url.replace('/pixeldata.mp4', '/rendered'),
        },
        // Transform WADO-URI URLs to use JPEG instead of DICOM
        wadouriTransform: url =>
          url.replace('contentType=application/dicom', 'contentType=image/jpeg'),
        omitQuotationForMultipartRequest: true,
        acceptHeader: '*/*',
      },
    },
    {
      namespace: '@ohif/extension-default.dataSourcesModule.dicomweb',
      sourceName: 'localviewer-application-dicom',
      configuration: {
        friendlyName: 'AWS S3 Static wado server',
        name: 'aws',
        wadoUriRoot:
          'https://med-pacs-dev-dicomcloudwebapi-linux-cyhzgxbbb5hqcgby.eastus-01.azurewebsites.net/wadouri',
        qidoRoot:
          'https://med-pacs-dev-dicomcloudwebapi-linux-cyhzgxbbb5hqcgby.eastus-01.azurewebsites.net/api',
        wadoRoot:
          'https://med-pacs-dev-dicomcloudwebapi-linux-cyhzgxbbb5hqcgby.eastus-01.azurewebsites.net/api',
        qidoSupportsIncludeField: true,
        imageRendering: 'wadouri',
        thumbnailRendering: 'wadouri',
        enableStudyLazyLoad: true,
        supportsFuzzyMatching: false,
        supportsWildcard: true,
        staticWado: true,
        singlepart: 'bulkdata,video',
        bulkDataURI: {
          enabled: true,
          relativeResolution: 'studies',
          transform: url => url.replace('/pixeldata.mp4', '/rendered'),
        },
        omitQuotationForMultipartRequest: true,
        acceptHeader: '*/*',
      },
    },
    {
      namespace: '@ohif/extension-default.dataSourcesModule.dicomweb',
      sourceName: 'localviewer-raw-dicom',
      configuration: {
        friendlyName: 'AWS S3 Static wado server',
        name: 'aws',
        wadoUriRoot:
          'https://med-pacs-dev-dicomcloudwebapi-linux-cyhzgxbbb5hqcgby.eastus-01.azurewebsites.net/api',
        qidoRoot:
          'https://med-pacs-dev-dicomcloudwebapi-linux-cyhzgxbbb5hqcgby.eastus-01.azurewebsites.net/api',
        wadoRoot:
          'https://med-pacs-dev-dicomcloudwebapi-linux-cyhzgxbbb5hqcgby.eastus-01.azurewebsites.net/api',
        qidoSupportsIncludeField: true,
        imageRendering: 'wadors',
        thumbnailRendering: 'wadors',
        enableStudyLazyLoad: true,
        supportsFuzzyMatching: false,
        supportsWildcard: true,
        staticWado: true,
        singlepart: 'bulkdata,video',
        bulkDataURI: {
          enabled: true,
          relativeResolution: 'studies',
          transform: url => url.replace('/pixeldata.mp4', '/rendered'),
        },
        wadouriTransform: url =>
          url.replace('contentType=application/dicom', 'contentType=image/jpeg'),
        omitQuotationForMultipartRequest: true,
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
        friendlyName: 'Demo PACS (Hardcoded Token)',
        name: 'Demo PACS',
        wadoUriRoot:
          'https://med-pacs-dev-dicomcloudwebapi-linux-cyhzgxbbb5hqcgby.eastus-01.azurewebsites.net/api',
        qidoRoot:
          'https://med-pacs-dev-dicomcloudwebapi-linux-cyhzgxbbb5hqcgby.eastus-01.azurewebsites.net/api',
        wadoRoot:
          'https://med-pacs-dev-dicomcloudwebapi-linux-cyhzgxbbb5hqcgby.eastus-01.azurewebsites.net/api',
        qidoSupportsIncludeField: false,
        imageRendering: 'wadors',
        thumbnailRendering: 'wadors',
        enableStudyLazyLoad: true,
        supportsFuzzyMatching: false,
        supportsWildcard: true,
        staticWado: true,
        singlepart: 'bulkdata,video',
        bulkDataURI: {
          enabled: true,
          relativeResolution: 'studies',
          transform: url => url.replace('/pixeldata.mp4', '/rendered'),
        },
        omitQuotationForMultipartRequest: true,
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

// Update defaultDataSourceName asynchronously and cache it
updateDefaultDataSourceName().catch(error => {
  console.error('Failed to update default data source name:', error);
});

// Expose preferences API for Settings UI (single shared fetch; response cached for app)
if (typeof window !== 'undefined') {
  window.fetchPreferences = fetchPreferences;
  window.savePreferences = savePreferences;
  window.clearPreferencesCache = clearPreferencesCache;
}
