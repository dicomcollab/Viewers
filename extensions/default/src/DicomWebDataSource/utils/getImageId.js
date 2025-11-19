import getWADORSImageId from './getWADORSImageId';

function buildInstanceWadoUrl(config, instance) {
  if (!instance) {
    throw new Error('buildInstanceWadoUrl: instance is required');
  }

  const { StudyInstanceUID, SeriesInstanceUID, SOPInstanceUID } = instance;

  if (!StudyInstanceUID || !SeriesInstanceUID || !SOPInstanceUID) {
    throw new Error(
      `buildInstanceWadoUrl: Missing required UIDs. StudyInstanceUID: ${StudyInstanceUID}, SeriesInstanceUID: ${SeriesInstanceUID}, SOPInstanceUID: ${SOPInstanceUID}`
    );
  }

  const params = [];

  params.push('requestType=WADO');
  params.push(`studyUID=${StudyInstanceUID}`);
  params.push(`seriesUID=${SeriesInstanceUID}`);
  params.push(`objectUID=${SOPInstanceUID}`);
  params.push('contentType=application/dicom');
  params.push('transferSyntax=*');

  const paramString = params.join('&');

  if (!config || !config.wadoUriRoot) {
    throw new Error('buildInstanceWadoUrl: config.wadoUriRoot is required');
  }

  return `${config.wadoUriRoot}?${paramString}`;
}

/**
 * Obtain an imageId for Cornerstone from an image instance
 *
 * @param instance
 * @param frame
 * @param thumbnail
 * @returns {string} The imageId to be used by Cornerstone
 */
export default function getImageId({ instance, frame, config, thumbnail = false }) {
  if (!instance) {
    return;
  }

  if (instance.imageId && frame === undefined) {
    return instance.imageId;
  }

  if (instance.url) {
    return instance.url;
  }

  const renderingAttr = thumbnail ? 'thumbnailRendering' : 'imageRendering';

  if (!config || !config[renderingAttr] || config[renderingAttr] === 'wadouri') {
    if (!config || !config.wadoUriRoot) {
      console.warn('getImageId: config or wadoUriRoot is missing');
      return;
    }

    try {
      let wadouri = buildInstanceWadoUrl(config, instance);
      let useJPEGProtocol = false;

      // Apply wadouriTransform if it exists in the config
      if (config.wadouriTransform && typeof config.wadouriTransform === 'function') {
        try {
          const originalWadouri = wadouri;
          wadouri = config.wadouriTransform(wadouri);
          // Check if the transform changed contentType to image/jpeg
          if (wadouri !== originalWadouri && wadouri.includes('contentType=image/jpeg')) {
            useJPEGProtocol = true;
          }
        } catch (error) {
          console.error('Error applying wadouriTransform:', error);
          // Continue with original URL if transform fails
        }
      }

      // Use dicomweb-jpeg protocol if we're using JPEG content type
      const protocol = useJPEGProtocol ? 'dicomweb-jpeg:' : 'dicomweb:';
      let imageId = protocol + wadouri;
      if (frame !== undefined) {
        imageId += '&frame=' + frame;
      }

      return imageId;
    } catch (error) {
      console.error('Error in getImageId (wadouri):', error);
      // Return undefined to let the caller handle the error
      return;
    }
  } else {
    try {
      return getWADORSImageId(instance, config, frame); // WADO-RS Retrieve Frame
    } catch (error) {
      console.error('Error in getImageId (wadors):', error);
      return;
    }
  }
}
