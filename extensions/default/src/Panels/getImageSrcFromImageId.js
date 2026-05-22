import { normalizeJpegImageId } from '../DicomWebDataSource/utils/getImageId';

/**
 * @param {*} cornerstone
 * @param {*} imageId
 */
function getImageSrcFromImageId(cornerstone, imageId) {
  const resolvedImageId = normalizeJpegImageId(imageId);
  return new Promise((resolve, reject) => {
    const canvas = document.createElement('canvas');
    cornerstone.utilities
      .loadImageToCanvas({ canvas, imageId: resolvedImageId, thumbnail: true })
      .then(imageId => {
        resolve(canvas.toDataURL());
      })
      .catch(reject);
  });
}
export default getImageSrcFromImageId;
