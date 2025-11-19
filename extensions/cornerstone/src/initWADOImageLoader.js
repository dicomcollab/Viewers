import { volumeLoader } from '@cornerstonejs/core';
import {
  cornerstoneStreamingImageVolumeLoader,
  cornerstoneStreamingDynamicImageVolumeLoader,
} from '@cornerstonejs/core/loaders';
import dicomImageLoader from '@cornerstonejs/dicom-image-loader';
import { errorHandler, utils } from '@ohif/core';
import { registerJPEGImageLoader } from './utils/jpegImageLoader';

const { registerVolumeLoader } = volumeLoader;

export default function initWADOImageLoader(
  userAuthenticationService,
  appConfig,
  extensionManager
) {
  registerVolumeLoader('cornerstoneStreamingImageVolume', cornerstoneStreamingImageVolumeLoader);

  registerVolumeLoader(
    'cornerstoneStreamingDynamicImageVolume',
    cornerstoneStreamingDynamicImageVolumeLoader
  );

  // Register JPEG image loader when data source is localviewer-image-jpeg
  const activeDataSource = extensionManager.getActiveDataSource()?.[0];
  const dataSourceName = activeDataSource?.sourceName || appConfig.defaultDataSourceName;

  if (dataSourceName === 'localviewer-image-jpeg') {
    registerJPEGImageLoader();
    console.log('JPEG Image Loader registered for localviewer-image-jpeg data source');
  }

  dicomImageLoader.init({
    maxWebWorkers: Math.min(
      Math.max(navigator.hardwareConcurrency - 1, 1),
      appConfig.maxNumberOfWebWorkers
    ),
    beforeSend: function () {
      //TODO should be removed in the future and request emitted by DicomWebDataSource
      const sourceConfig = extensionManager.getActiveDataSource()?.[0].getConfig() ?? {};

      // Check if we're on a demo route and use demo token
      const isDemo =
        typeof window !== 'undefined' &&
        window.isDemoRoute &&
        typeof window.isDemoRoute === 'function'
          ? window.isDemoRoute()
          : false;
      const demoToken =
        typeof window !== 'undefined' &&
        window.getDemoToken &&
        typeof window.getDemoToken === 'function'
          ? window.getDemoToken()
          : null;

      let headers;
      if (isDemo && demoToken) {
        // Use Basic auth for demo token
        headers = {
          Authorization: `Basic ${demoToken}`,
        };
      } else {
        headers = userAuthenticationService.getAuthorizationHeader();
      }

      const acceptHeader = utils.generateAcceptHeader(
        sourceConfig.acceptHeader,
        sourceConfig.requestTransferSyntaxUID,
        sourceConfig.omitQuotationForMultipartRequest
      );

      const xhrRequestHeaders = {
        Accept: Array.isArray(acceptHeader) ? acceptHeader.join(', ') : acceptHeader,
      };

      if (headers) {
        Object.assign(xhrRequestHeaders, headers);
      }

      return xhrRequestHeaders;
    },
    errorInterceptor: () => {
      errorHandler.getHTTPErrorHandler();
    },
  });
}

export function destroy() {
  console.debug('Destroying WADO Image Loader');
}
