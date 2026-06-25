import { api } from 'dicomweb-client';
import { DicomMetadataStore, IWebApiDataSource, utils, errorHandler, classes } from '@ohif/core';

import {
  mapParams,
  search as qidoSearch,
  seriesInStudy,
  processResults,
  processSeriesResults,
} from './qido.js';
import dcm4cheeReject from './dcm4cheeReject.js';

import getImageId from './utils/getImageId.js';
import dcmjs from 'dcmjs';
import { retrieveStudyMetadata, deleteStudyMetadataPromise } from './retrieveStudyMetadata.js';
import StaticWadoClient from './utils/StaticWadoClient';
import getDirectURL from '../utils/getDirectURL';
import { fixBulkDataURI } from './utils/fixBulkDataURI';
import { cleanDenaturalizedDataset } from './utils/cleanDenaturalizedDataset';
import { HeadersInterface } from '@ohif/core/src/types/RequestHeaders';
import { getCachedStudiesSearch } from './utils/studiesQueryCache.js';

const { DicomMetaDictionary, DicomDict } = dcmjs.data;

const { naturalizeDataset, denaturalizeDataset } = DicomMetaDictionary;

type PacsAuthRequestHook = (request: XMLHttpRequest, metadata?: object) => XMLHttpRequest;

function buildPacsAuthRequestHooks(
  existing: PacsAuthRequestHook[] | undefined,
  resolveAuthHeaders: () => HeadersInterface
): PacsAuthRequestHook[] {
  const injectAuth: PacsAuthRequestHook = request => {
    const auth = resolveAuthHeaders();
    if (auth?.Authorization) {
      request.setRequestHeader('Authorization', auth.Authorization);
    }
    return request;
  };
  return [...(existing || []), injectAuth];
}

const ImplementationClassUID = '2.25.270695996825855179949881587723571202391.2.0.0';
const ImplementationVersionName = 'OHIF-3.11.0';
const EXPLICIT_VR_LITTLE_ENDIAN = '1.2.840.10008.1.2.1';

const metadataProvider = classes.MetadataProvider;

export type DicomWebConfig = {
  /** Data source name */
  name: string;
  //  wadoUriRoot - Legacy? (potentially unused/replaced)
  /** Base URL to use for QIDO requests */
  qidoRoot?: string;
  wadoRoot?: string; // - Base URL to use for WADO requests
  wadoUri?: string; // - Base URL to use for WADO URI requests
  qidoSupportsIncludeField?: boolean; // - Whether QIDO supports the "Include" option to request additional fields in response
  imageRendering?: string; // - wadors | ? (unsure of where/how this is used)
  thumbnailRendering?: string;
  /**
   wadors - render using the wadors fetch.  The full image is retrieved and rendered in cornerstone to thumbnail size  png and returned as binary data to the src attribute of the  image tag.
           for example,  <img  src=data:image/png;base64,sdlfk;adkfadfk....asldfjkl;asdkf>
   thumbnailDirect -  get the direct url endpoint for the thumbnail as the image src (eg not authentication required).
           for example, <img src=http://server:port/wadors/studies/1.2.3/thumbnail?accept=image/jpeg>
   thumbnail - render using the thumbnail endpoint on wadors using bulkDataURI, passing authentication params  to the url.
    rendered - should use the rendered endpoint instead of the thumbnail endpoint
*/
  /** Whether the server supports reject calls (i.e. DCM4CHEE) */
  supportsReject?: boolean;
  /** indicates if the retrieves can fetch singlepart. Options are bulkdata, video, image, or  true */
  singlepart?: boolean | string;
  /** Transfer syntax to request from the server */
  requestTransferSyntaxUID?: string;
  acceptHeader?: string[]; // - Accept header to use for requests
  /** Whether to omit quotation marks for multipart requests */
  omitQuotationForMultipartRequest?: boolean;
  /** Whether the server supports fuzzy matching */
  supportsFuzzyMatching?: boolean;
  /** Whether the server supports wildcard matching */
  supportsWildcard?: boolean;
  /** Whether the server supports the native DICOM model */
  supportsNativeDICOMModel?: boolean;
  /** Whether to enable request tag */
  enableRequestTag?: boolean;
  /** Whether to enable study lazy loading */
  enableStudyLazyLoad?: boolean;
  /** Whether to enable bulkDataURI */
  bulkDataURI?: BulkDataURIConfig;
  /** Function that is called after the configuration is initialized */
  onConfiguration: (config: DicomWebConfig, params) => DicomWebConfig;
  /** Whether to use the static WADO client */
  staticWado?: boolean;
  /** Azure Health Data Services DICOM v2: Bearer auth and QIDO/WADO header behavior */
  isAzureDicomV2?: boolean;
  /** Optional Bearer token for Azure DICOM (falls back to window.AZURE_PACS_TOKEN) */
  azureToken?: string;
  /** User authentication service */
  userAuthenticationService: Record<string, unknown>;
};

export type BulkDataURIConfig = {
  /** Enable bulkdata uri configuration */
  enabled?: boolean;
  /**
   * Remove the startsWith string.
   * This is used to correct reverse proxied URLs by removing the startsWith path
   */
  startsWith?: string;
  /**
   * Adds this prefix path.  Only used if the startsWith is defined and has
   * been removed.  This allows replacing the base path.
   */
  prefixWith?: string;
  /** Transform the bulkdata path.  Used to replace a portion of the path */
  transform?: (uri: string) => string;
  /**
   * Adds relative resolution to the path handling.
   * series is the default, as the metadata retrieved is series level.
   */
  relativeResolution?: 'studies' | 'series';
};

/**
 * The header options are the options passed into the generateWadoHeader
 * command.  This takes an extensible set of attributes to allow future enhancements.
 */
export interface HeaderOptions {
  includeTransferSyntax?: boolean;
}

function resolvePacsRouteBaseUrl(rawUrl?: string): string | undefined {
  if (!rawUrl) {
    return rawUrl;
  }

  if (typeof window === 'undefined') {
    return rawUrl;
  }

  const appConfig = (window as unknown as { config?: { pacsIntegration?: string } }).config;
  const pacsIntegration = appConfig?.pacsIntegration === 'azurepacs' ? 'azurepacs' : 'medpacs';
  const routePrefix = pacsIntegration === 'azurepacs' ? 'dicomservice' : 'api';

  const trimmed = rawUrl.replace(/\/+$/, '');
  const domainBase = trimmed.replace(/\/(api|dicomservice|v\d+)$/i, '');

  return `${domainBase}/${routePrefix}`;
}

/**
 * Metadata and some other requests don't permit the transfer syntax to be included,
 * so pass in the excludeTransferSyntax parameter.
 */
export const excludeTransferSyntax: HeaderOptions = { includeTransferSyntax: false };

/**
 * Creates a DICOM Web API based on the provided configuration.
 *
 * @param dicomWebConfig - Configuration for the DICOM Web API
 * @returns DICOM Web API object
 */
function createDicomWebApi(dicomWebConfig: DicomWebConfig, servicesManager) {
  const { userAuthenticationService } = servicesManager.services;
  let dicomWebConfigCopy,
    qidoConfig,
    wadoConfig,
    qidoDicomWebClient,
    wadoDicomWebClient,
    getAuthorizationHeader,
    generateWadoHeader;
  // Default to enabling bulk data retrieves, with no other customization as
  // this is part of hte base standard.
  dicomWebConfig.bulkDataURI ||= { enabled: true };

  const implementation = {
    initialize: ({ params, query }) => {
      if (dicomWebConfig.onConfiguration && typeof dicomWebConfig.onConfiguration === 'function') {
        dicomWebConfig = dicomWebConfig.onConfiguration(dicomWebConfig, {
          params,
          query,
        });
      }

      dicomWebConfigCopy = JSON.parse(JSON.stringify(dicomWebConfig));

      getAuthorizationHeader = () => {
        const xhrRequestHeaders: HeadersInterface = {};

        const demoBasic =
          typeof window !== 'undefined' &&
          (window as unknown as { getDemoEnvBasicAuthToken?: () => string | null })
            .getDemoEnvBasicAuthToken &&
          typeof (window as unknown as { getDemoEnvBasicAuthToken: () => string | null })
            .getDemoEnvBasicAuthToken === 'function'
            ? (
                window as unknown as { getDemoEnvBasicAuthToken: () => string | null }
              ).getDemoEnvBasicAuthToken()
            : null;

        if (demoBasic) {
          xhrRequestHeaders.Authorization = `Basic ${demoBasic}`;
          return xhrRequestHeaders;
        }

        const viewerBearer =
          typeof window !== 'undefined' &&
          (window as unknown as { getViewerAccessBearerToken?: () => string | null })
            .getViewerAccessBearerToken &&
          typeof (window as unknown as { getViewerAccessBearerToken: () => string | null })
            .getViewerAccessBearerToken === 'function'
            ? (
                window as unknown as { getViewerAccessBearerToken: () => string | null }
              ).getViewerAccessBearerToken()
            : null;

        if (viewerBearer) {
          xhrRequestHeaders.Authorization = `Bearer ${viewerBearer}`;
          return xhrRequestHeaders;
        }

        const isAzureDicomV2 = dicomWebConfig.isAzureDicomV2 === true;
        const preferCookieAuth =
          typeof window !== 'undefined' &&
          (window as unknown as { config?: { azurePacsPreferCookieAuth?: boolean } }).config
            ?.azurePacsPreferCookieAuth === true;
        const azureTokenFromConfig = dicomWebConfig.azureToken;
        const azureTokenFromWindow =
          typeof window !== 'undefined'
            ? (window as unknown as { AZURE_PACS_TOKEN?: string }).AZURE_PACS_TOKEN
            : null;
        const azureToken = azureTokenFromConfig || azureTokenFromWindow || null;

        if (
          isAzureDicomV2 &&
          !preferCookieAuth &&
          azureToken &&
          typeof azureToken === 'string' &&
          azureToken.trim()
        ) {
          xhrRequestHeaders.Authorization = `Bearer ${azureToken.trim()}`;
          return xhrRequestHeaders;
        }

        const authHeaders = userAuthenticationService.getAuthorizationHeader();
        if (authHeaders && authHeaders.Authorization) {
          xhrRequestHeaders.Authorization = authHeaders.Authorization;
        }
        return xhrRequestHeaders;
      };

      const pacsAuthRequestHooks = buildPacsAuthRequestHooks(
        dicomWebConfig.requestHooks,
        getAuthorizationHeader
      );

      /**
       * Generates the wado header for requesting resources from DICOMweb.
       * These are classified into those that are dependent on the transfer syntax
       * and those that aren't, as defined by the include transfer syntax attribute.
       */
      generateWadoHeader = (options: HeaderOptions): HeadersInterface => {
        const authorizationHeader = getAuthorizationHeader();
        if (dicomWebConfig.isAzureDicomV2 === true && options?.includeTransferSyntax !== false) {
          let acceptHeaderValue = '*/*';
          const ah = dicomWebConfig.acceptHeader;
          const hasAccept =
            ah !== undefined && ah !== null && !(Array.isArray(ah) && ah.length === 0);
          if (hasAccept) {
            if (typeof ah === 'string') {
              acceptHeaderValue = ah;
            } else if (Array.isArray(ah)) {
              acceptHeaderValue = ah.length === 1 ? ah[0] : ah.join(', ');
            }
          }
          return {
            ...authorizationHeader,
            Accept: acceptHeaderValue,
          };
        }
        if (options?.includeTransferSyntax !== false) {
          //Generate accept header depending on config params
          const formattedAcceptHeader = utils.generateAcceptHeader(
            dicomWebConfig.acceptHeader,
            dicomWebConfig.requestTransferSyntaxUID,
            dicomWebConfig.omitQuotationForMultipartRequest
          );
          return {
            ...authorizationHeader,
            Accept: formattedAcceptHeader,
          };
        } else {
          // The base header will be included in the request. We simply skip customization options around
          // transfer syntaxes and whether the request is multipart. In other words, a request in
          // which the server expects Accept: application/dicom+json will still include that in the
          // header.
          return {
            ...authorizationHeader,
          };
        }
      };

      // Normalize api | dicomservice | v2 base from config; also update dicomWebConfig so WADO image IDs,
      // bulkDataURI, and instance.wadoRoot use the same prefix as the DICOMweb client (not raw .../v2).
      const qidoBaseUrl =
        resolvePacsRouteBaseUrl(dicomWebConfig.qidoRoot) || dicomWebConfig.qidoRoot;
      const wadoBaseUrl =
        resolvePacsRouteBaseUrl(dicomWebConfig.wadoRoot) || dicomWebConfig.wadoRoot;
      dicomWebConfig.qidoRoot = qidoBaseUrl;
      dicomWebConfig.wadoRoot = wadoBaseUrl;

      if (dicomWebConfig.isAzureDicomV2 === true) {
        const initialAuthHeaders = getAuthorizationHeader();
        const qidoHeaders: HeadersInterface = { ...initialAuthHeaders, Accept: '*/*' };
        qidoConfig = {
          url: qidoBaseUrl,
          staticWado: dicomWebConfig.staticWado,
          singlepart: dicomWebConfig.singlepart,
          headers: qidoHeaders,
          requestHooks: pacsAuthRequestHooks,
          errorInterceptor: errorHandler.getHTTPErrorHandler(),
          supportsFuzzyMatching: dicomWebConfig.supportsFuzzyMatching,
        };
        wadoConfig = {
          url: wadoBaseUrl,
          staticWado: dicomWebConfig.staticWado,
          singlepart: dicomWebConfig.singlepart,
          headers: initialAuthHeaders,
          requestHooks: pacsAuthRequestHooks,
          errorInterceptor: errorHandler.getHTTPErrorHandler(),
          supportsFuzzyMatching: dicomWebConfig.supportsFuzzyMatching,
        };
      } else {
        const initialAuthHeaders = getAuthorizationHeader();
        qidoConfig = {
          url: qidoBaseUrl,
          staticWado: dicomWebConfig.staticWado,
          singlepart: dicomWebConfig.singlepart,
          headers: initialAuthHeaders,
          requestHooks: pacsAuthRequestHooks,
          errorInterceptor: errorHandler.getHTTPErrorHandler(),
          supportsFuzzyMatching: dicomWebConfig.supportsFuzzyMatching,
        };

        wadoConfig = {
          url: wadoBaseUrl,
          staticWado: dicomWebConfig.staticWado,
          singlepart: dicomWebConfig.singlepart,
          headers: initialAuthHeaders,
          requestHooks: pacsAuthRequestHooks,
          errorInterceptor: errorHandler.getHTTPErrorHandler(),
          supportsFuzzyMatching: dicomWebConfig.supportsFuzzyMatching,
        };
      }

      // TODO -> Two clients sucks, but its better than 1000.
      // TODO -> We'll need to merge auth later.
      qidoDicomWebClient = dicomWebConfig.staticWado
        ? new StaticWadoClient(qidoConfig)
        : new api.DICOMwebClient(qidoConfig);

      wadoDicomWebClient = dicomWebConfig.staticWado
        ? new StaticWadoClient(wadoConfig)
        : new api.DICOMwebClient(wadoConfig);

      dicomWebConfigCopy = JSON.parse(JSON.stringify(dicomWebConfig));
    },
    query: {
      studies: {
        mapParams: mapParams.bind(),
        search: async function (origParams) {
          const fetchStudies = async () => {
            const searchHeaders = getAuthorizationHeader();
            if (dicomWebConfig.isAzureDicomV2 === true) {
              searchHeaders.Accept = '*/*';
            }
            qidoDicomWebClient.headers = searchHeaders;
            const { studyInstanceUid, seriesInstanceUid, ...mappedParams } =
              mapParams(origParams, {
                supportsFuzzyMatching: dicomWebConfig.supportsFuzzyMatching,
                supportsWildcard: dicomWebConfig.supportsWildcard,
              }) || {};

            const results = await qidoSearch(
              qidoDicomWebClient,
              undefined,
              undefined,
              mappedParams
            );

            return processResults(results);
          };

          // Use cached studies search if available
          return getCachedStudiesSearch(fetchStudies, dicomWebConfig.name || 'default', origParams);
        },
        processResults: processResults.bind(),
      },
      series: {
        // mapParams: mapParams.bind(),
        search: async function (studyInstanceUid) {
          const { getCachedStudiesSearch } = require('./utils/studiesQueryCache.js');

          const fetchSeries = async () => {
            const searchHeaders = getAuthorizationHeader();
            if (dicomWebConfig.isAzureDicomV2 === true) {
              searchHeaders.Accept = '*/*';
            }
            qidoDicomWebClient.headers = searchHeaders;
            const results = await seriesInStudy(qidoDicomWebClient, studyInstanceUid);
            return processSeriesResults(results);
          };

          // Create a query key for series search (different from studies search)
          const queryClient =
            typeof window !== 'undefined' && window.__OHIF_QUERY_CLIENT__
              ? window.__OHIF_QUERY_CLIENT__
              : null;

          if (queryClient) {
            const queryKey = ['seriesSearch', dicomWebConfig.name || 'default', studyInstanceUid];

            try {
              const cachedData = queryClient.getQueryData(queryKey);
              if (cachedData) {
                console.log(
                  `[Series Search Cache] ✅ CACHE HIT - Study: ${studyInstanceUid.substring(0, 20)}...`
                );
                return cachedData;
              }

              console.log(
                `[Series Search Cache] ❌ CACHE MISS - Fetching series for study: ${studyInstanceUid.substring(0, 20)}...`
              );

              const data = await queryClient.fetchQuery({
                queryKey,
                queryFn: async () => {
                  console.log(
                    `[Series Search Cache] 🔄 Fetching series from API: ${studyInstanceUid.substring(0, 20)}...`
                  );
                  const result = await fetchSeries();
                  console.log(
                    `[Series Search Cache] ✅ Cached series (${result?.length || 0} series)`
                  );
                  return result;
                },
                staleTime: 1000, // 1 hour
                gcTime: 1000, // 24 hours
              });

              return data;
            } catch (error) {
              console.warn('[Series Search Cache] Error, falling back to direct fetch:', error);
              return fetchSeries();
            }
          }

          return fetchSeries();
        },
        // processResults: processResults.bind(),
      },
      instances: {
        search: (studyInstanceUid, queryParameters) => {
          const searchHeaders = getAuthorizationHeader();
          if (dicomWebConfig.isAzureDicomV2 === true) {
            searchHeaders.Accept = '*/*';
          }
          qidoDicomWebClient.headers = searchHeaders;
          return qidoSearch.call(
            undefined,
            qidoDicomWebClient,
            studyInstanceUid,
            null,
            queryParameters
          );
        },
      },
    },
    retrieve: {
      /**
       * Generates a URL that can be used for direct retrieve of the bulkdata
       *
       * @param {object} params
       * @param {string} params.tag is the tag name of the URL to retrieve
       * @param {object} params.instance is the instance object that the tag is in
       * @param {string} params.defaultType is the mime type of the response
       * @param {string} params.singlepart is the type of the part to retrieve
       * @returns an absolute URL to the resource, if the absolute URL can be retrieved as singlepart,
       *    or is already retrieved, or a promise to a URL for such use if a BulkDataURI
       */

      getGetThumbnailSrc: function (instance, imageId) {
        if (dicomWebConfig.thumbnailRendering === 'wadors') {
          return function getThumbnailSrc(options) {
            if (!imageId) {
              return null;
            }
            if (!options?.getImageSrc) {
              return null;
            }
            return options.getImageSrc(imageId);
          };
        }
        if (dicomWebConfig.thumbnailRendering === 'thumbnailDirect') {
          return function getThumbnailSrc() {
            return this.directURL({
              instance: instance,
              defaultPath: '/thumbnail',
              defaultType: 'image/jpeg',
              singlepart: true,
              tag: 'Absent',
            });
          }.bind(this);
        }

        if (dicomWebConfig.thumbnailRendering === 'thumbnail') {
          return async function getThumbnailSrc() {
            const { StudyInstanceUID, SeriesInstanceUID, SOPInstanceUID } = instance;
            const bulkDataURI = `${dicomWebConfig.wadoRoot}/studies/${StudyInstanceUID}/series/${SeriesInstanceUID}/instances/${SOPInstanceUID}/thumbnail?accept=image/jpeg`;
            return URL.createObjectURL(
              new Blob(
                [
                  await this.bulkDataURI({
                    BulkDataURI: bulkDataURI.replace('wadors:', ''),
                    defaultType: 'image/jpeg',
                    mediaTypes: ['image/jpeg'],
                    thumbnail: true,
                  }),
                ],
                { type: 'image/jpeg' }
              )
            );
          }.bind(this);
        }
        if (dicomWebConfig.thumbnailRendering === 'rendered') {
          return async function getThumbnailSrc() {
            const { StudyInstanceUID, SeriesInstanceUID, SOPInstanceUID } = instance;
            const bulkDataURI = `${dicomWebConfig.wadoRoot}/studies/${StudyInstanceUID}/series/${SeriesInstanceUID}/instances/${SOPInstanceUID}/rendered?accept=image/jpeg`;
            return URL.createObjectURL(
              new Blob(
                [
                  await this.bulkDataURI({
                    BulkDataURI: bulkDataURI.replace('wadors:', ''),
                    defaultType: 'image/jpeg',
                    mediaTypes: ['image/jpeg'],
                    thumbnail: true,
                  }),
                ],
                { type: 'image/jpeg' }
              )
            );
          }.bind(this);
        }
      },

      directURL: params => {
        return getDirectURL(
          {
            wadoRoot: dicomWebConfig.wadoRoot,
            singlepart: dicomWebConfig.singlepart,
          },
          params
        );
      },
      /**
       * Provide direct access to the dicom web client for certain use cases
       * where the dicom web client is used by an external library such as the
       * microscopy viewer.
       * Note this instance only needs to support the wado queries, and may not
       * support any QIDO or STOW operations.
       */
      getWadoDicomWebClient: () => wadoDicomWebClient,

      bulkDataURI: async ({ StudyInstanceUID, BulkDataURI }) => {
        qidoDicomWebClient.headers = getAuthorizationHeader();
        const options = {
          multipart: false,
          BulkDataURI,
          StudyInstanceUID,
        };
        return qidoDicomWebClient.retrieveBulkData(options).then(val => {
          const ret = (val && val[0]) || undefined;
          return ret;
        });
      },
      series: {
        metadata: async ({
          StudyInstanceUID,
          filters,
          sortCriteria,
          sortFunction,
          madeInClient = false,
          returnPromises = false,
        } = {}) => {
          if (!StudyInstanceUID) {
            throw new Error('Unable to query for SeriesMetadata without StudyInstanceUID');
          }

          if (dicomWebConfig.enableStudyLazyLoad) {
            return implementation._retrieveSeriesMetadataAsync(
              StudyInstanceUID,
              filters,
              sortCriteria,
              sortFunction,
              madeInClient,
              returnPromises
            );
          }

          return implementation._retrieveSeriesMetadataSync(
            StudyInstanceUID,
            filters,
            sortCriteria,
            sortFunction,
            madeInClient
          );
        },
      },
    },

    store: {
      dicom: async (dataset, request, dicomDict) => {
        wadoDicomWebClient.headers = getAuthorizationHeader();
        if (dataset instanceof ArrayBuffer) {
          const options = {
            datasets: [dataset],
            request,
          };
          await wadoDicomWebClient.storeInstances(options);
        } else {
          let effectiveDicomDict = dicomDict;

          if (!dicomDict) {
            const meta = {
              FileMetaInformationVersion: dataset._meta?.FileMetaInformationVersion?.Value,
              MediaStorageSOPClassUID: dataset.SOPClassUID,
              MediaStorageSOPInstanceUID: dataset.SOPInstanceUID,
              TransferSyntaxUID: EXPLICIT_VR_LITTLE_ENDIAN,
              ImplementationClassUID,
              ImplementationVersionName,
            };

            const denaturalized = denaturalizeDataset(meta);
            const defaultDicomDict = new DicomDict(denaturalized);
            defaultDicomDict.dict = denaturalizeDataset(dataset);

            effectiveDicomDict = defaultDicomDict;
          }

          const part10Buffer = effectiveDicomDict.write();

          const options = {
            datasets: [part10Buffer],
            request,
          };

          await wadoDicomWebClient.storeInstances(options);
        }
      },
    },

    _retrieveSeriesMetadataSync: async (
      StudyInstanceUID,
      filters,
      sortCriteria,
      sortFunction,
      madeInClient
    ) => {
      const enableStudyLazyLoad = false;
      wadoDicomWebClient.headers = generateWadoHeader(excludeTransferSyntax);
      // data is all SOPInstanceUIDs
      const data = await retrieveStudyMetadata(
        wadoDicomWebClient,
        StudyInstanceUID,
        enableStudyLazyLoad,
        filters,
        sortCriteria,
        sortFunction,
        dicomWebConfig
      );

      // first naturalize the data
      const naturalizedInstancesMetadata = data.map(instance =>
        cleanDenaturalizedDataset(naturalizeDataset(instance))
      );

      const seriesSummaryMetadata = {};
      const instancesPerSeries = {};

      naturalizedInstancesMetadata.forEach(instance => {
        if (!seriesSummaryMetadata[instance.SeriesInstanceUID]) {
          seriesSummaryMetadata[instance.SeriesInstanceUID] = {
            StudyInstanceUID: instance.StudyInstanceUID,
            StudyDescription: instance.StudyDescription,
            SeriesInstanceUID: instance.SeriesInstanceUID,
            SeriesDescription: instance.SeriesDescription,
            SeriesNumber: instance.SeriesNumber,
            SeriesTime: instance.SeriesTime,
            SOPClassUID: instance.SOPClassUID,
            ProtocolName: instance.ProtocolName,
            Modality: instance.Modality,
          };
        }

        if (!instancesPerSeries[instance.SeriesInstanceUID]) {
          instancesPerSeries[instance.SeriesInstanceUID] = [];
        }

        const imageId = implementation.getImageIdsForInstance({
          instance,
        });

        instance.imageId = imageId;
        instance.wadoRoot = dicomWebConfig.wadoRoot;
        instance.wadoUri = dicomWebConfig.wadoUri;

        metadataProvider.addImageIdToUIDs(imageId, {
          StudyInstanceUID,
          SeriesInstanceUID: instance.SeriesInstanceUID,
          SOPInstanceUID: instance.SOPInstanceUID,
        });

        instancesPerSeries[instance.SeriesInstanceUID].push(instance);
      });

      // grab all the series metadata
      const seriesMetadata = Object.values(seriesSummaryMetadata);
      DicomMetadataStore.addSeriesMetadata(seriesMetadata, madeInClient);

      Object.keys(instancesPerSeries).forEach(seriesInstanceUID =>
        DicomMetadataStore.addInstances(instancesPerSeries[seriesInstanceUID], madeInClient)
      );

      return seriesSummaryMetadata;
    },

    _retrieveSeriesMetadataAsync: async (
      StudyInstanceUID,
      filters,
      sortCriteria,
      sortFunction,
      madeInClient = false,
      returnPromises = false
    ) => {
      const enableStudyLazyLoad = true;
      wadoDicomWebClient.headers = generateWadoHeader(excludeTransferSyntax);
      // Get Series
      const { preLoadData: seriesSummaryMetadata, promises: seriesPromises } =
        await retrieveStudyMetadata(
          wadoDicomWebClient,
          StudyInstanceUID,
          enableStudyLazyLoad,
          filters,
          sortCriteria,
          sortFunction,
          dicomWebConfig
        );

      /**
       * Adds the retrieve bulkdata function to naturalized DICOM data.
       * This is done recursively, for sub-sequences.
       */
      const addRetrieveBulkDataNaturalized = (naturalized, instance = naturalized) => {
        if (!naturalized) {
          return naturalized;
        }
        for (const key of Object.keys(naturalized)) {
          const value = naturalized[key];
          if (value == null) {
            continue;
          }

          if (Array.isArray(value) && typeof value[0] === 'object') {
            // Fix recursive values
            const validValues = value.filter(Boolean);
            validValues.forEach(child => addRetrieveBulkDataNaturalized(child, instance));
            continue;
          }

          // The value.Value will be set with the bulkdata read value
          // in which case it isn't necessary to re-read this.
          if (value && value.BulkDataURI && !value.Value) {
            // handle the scenarios where bulkDataURI is relative path
            fixBulkDataURI(value, instance, dicomWebConfig);
            // Provide a method to fetch bulkdata
            value.retrieveBulkData = retrieveBulkData.bind(qidoDicomWebClient, value);
          }
        }
        return naturalized;
      };

      /**
       * naturalizes the dataset, and adds a retrieve bulkdata method
       * to any values containing BulkDataURI.
       * @param {*} instance
       * @returns naturalized dataset, with retrieveBulkData methods
       */
      const addRetrieveBulkData = instance => {
        const naturalized = cleanDenaturalizedDataset(naturalizeDataset(instance));

        // if we know the server doesn't use bulkDataURI, then don't
        if (!dicomWebConfig.bulkDataURI?.enabled) {
          return naturalized;
        }

        return addRetrieveBulkDataNaturalized(naturalized);
      };

      // Async load series, store as retrieved
      function storeInstances(instances) {
        const naturalizedInstances = instances.map(addRetrieveBulkData);

        // Adding instanceMetadata to OHIF MetadataProvider
        naturalizedInstances.forEach(instance => {
          instance.wadoRoot = dicomWebConfig.wadoRoot;
          instance.wadoUri = dicomWebConfig.wadoUri;

          const { StudyInstanceUID, SeriesInstanceUID, SOPInstanceUID } = instance;
          const numberOfFrames = instance.NumberOfFrames || 1;
          // Process all frames consistently, whether single or multiframe
          for (let i = 0; i < numberOfFrames; i++) {
            const frameNumber = i + 1;
            const frameImageId = implementation.getImageIdsForInstance({
              instance,
              frame: frameNumber,
            });
            // Add imageId specific mapping to this data as the URL isn't necessarily WADO-URI.
            metadataProvider.addImageIdToUIDs(frameImageId, {
              StudyInstanceUID,
              SeriesInstanceUID,
              SOPInstanceUID,
              frameNumber: numberOfFrames > 1 ? frameNumber : undefined,
            });
          }

          // Adding imageId to each instance
          // Todo: This is not the best way I can think of to let external
          // metadata handlers know about the imageId that is stored in the store
          const imageId = implementation.getImageIdsForInstance({
            instance,
          });
          instance.imageId = imageId;
        });

        DicomMetadataStore.addInstances(naturalizedInstances, madeInClient);
      }

      function setSuccessFlag() {
        const study = DicomMetadataStore.getStudy(StudyInstanceUID);
        if (!study) {
          return;
        }
        study.isLoaded = true;
      }

      // Google Cloud Healthcare doesn't return StudyInstanceUID, so we need to add
      // it manually here
      seriesSummaryMetadata.forEach(aSeries => {
        aSeries.StudyInstanceUID = StudyInstanceUID;
      });

      DicomMetadataStore.addSeriesMetadata(seriesSummaryMetadata, madeInClient);

      const seriesDeliveredPromises = seriesPromises.map(promise => {
        if (!returnPromises) {
          promise?.start();
        }
        return promise.then(instances => {
          storeInstances(instances);
        });
      });

      if (returnPromises) {
        Promise.all(seriesDeliveredPromises).then(() => setSuccessFlag());
        return seriesPromises;
      } else {
        await Promise.all(seriesDeliveredPromises);
        setSuccessFlag();
      }

      return seriesSummaryMetadata;
    },
    deleteStudyMetadataPromise,
    getImageIdsForDisplaySet(displaySet) {
      const images = displaySet.images;
      const imageIds = [];

      if (!images) {
        return imageIds;
      }

      displaySet.images.forEach(instance => {
        const NumberOfFrames = instance.NumberOfFrames;

        if (NumberOfFrames > 1) {
          for (let frame = 1; frame <= NumberOfFrames; frame++) {
            const imageId = this.getImageIdsForInstance({
              instance,
              frame,
            });
            imageIds.push(imageId);
          }
        } else {
          const imageId = this.getImageIdsForInstance({ instance });
          imageIds.push(imageId);
        }
      });

      return imageIds;
    },
    getImageIdsForInstance({ instance, frame = undefined }) {
      const imageIds = getImageId({
        instance,
        frame,
        config: dicomWebConfig,
      });
      return imageIds;
    },
    getConfig() {
      return dicomWebConfigCopy;
    },
    getStudyInstanceUIDs({ params, query }) {
      const paramsStudyInstanceUIDs = params.StudyInstanceUIDs || params.studyInstanceUIDs;

      const queryStudyInstanceUIDs = utils.splitComma(
        query.getAll('StudyInstanceUIDs').concat(query.getAll('studyInstanceUIDs'))
      );

      const StudyInstanceUIDs =
        (queryStudyInstanceUIDs.length && queryStudyInstanceUIDs) || paramsStudyInstanceUIDs;
      const StudyInstanceUIDsAsArray =
        StudyInstanceUIDs && Array.isArray(StudyInstanceUIDs)
          ? StudyInstanceUIDs
          : [StudyInstanceUIDs];

      return StudyInstanceUIDsAsArray;
    },
  };

  if (dicomWebConfig.supportsReject) {
    implementation.reject = dcm4cheeReject(dicomWebConfig.wadoRoot, getAuthorizationHeader);
  }

  return IWebApiDataSource.create(implementation);
}

/**
 * A bindable function that retrieves the bulk data against this as the
 * dicomweb client, and on the given value element.
 *
 * @param value - a bind value that stores the retrieve value to short circuit the
 *    next retrieve instance.
 * @param options - to allow specifying the content type.
 */
function retrieveBulkData(value, options = {}) {
  const { mediaType } = options;
  const useOptions = {
    // The bulkdata fetches work with either multipart or
    // singlepart, so set multipart to false to let the server
    // decide which type to respond with.
    multipart: false,
    BulkDataURI: value.BulkDataURI,
    mediaTypes: mediaType ? [{ mediaType }, { mediaType: 'application/octet-stream' }] : undefined,
    ...options,
  };
  return this.retrieveBulkData(useOptions).then(val => {
    // There are DICOM PDF cases where the first ArrayBuffer in the array is
    // the bulk data and DICOM video cases where the second ArrayBuffer is
    // the bulk data. Here we play it safe and do a find.
    const ret =
      (val instanceof Array && val.find(arrayBuffer => arrayBuffer?.byteLength)) || undefined;
    value.Value = ret;
    return ret;
  });
}

export { createDicomWebApi };
