import { metaData, utilities } from '@cornerstonejs/core';

const { getScalingParameters } = utilities;

/**
 * Cornerstone's isPTPrescaledWithSUV reads image.preScale.scaled without optional chaining.
 * JPEG WADO-URI images and some stack paths never set preScale — PT on GPU then throws in production.
 */
export function ensureImagePreScale(image) {
  if (!image?.imageId) {
    return image;
  }

  const scalingModule = metaData.get('scalingModule', image.imageId) || { scaled: false };
  let scalingParameters;

  try {
    scalingParameters = getScalingParameters(image.imageId) || {};
  } catch {
    scalingParameters = {};
  }

  const scaled = scalingModule.scaled ?? image.preScale?.scaled ?? false;

  if (!image.preScale) {
    image.preScale = {
      enabled: false,
      scaled,
      scalingParameters,
    };
    return image;
  }

  if (image.preScale.scaled === undefined) {
    image.preScale.scaled = scaled;
  }

  image.preScale.scalingParameters = {
    ...scalingParameters,
    ...(image.preScale.scalingParameters || {}),
  };

  return image;
}
