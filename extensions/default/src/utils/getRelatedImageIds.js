/**
 * All Cornerstone imageIds for an instance (base + per-frame WADO-URI variants).
 */
export default function getRelatedImageIds(instance) {
  const baseImageId = instance?.imageId;
  if (!baseImageId) {
    return [];
  }

  const numberOfFrames = Number(instance.NumberOfFrames) || 1;
  if (numberOfFrames <= 1) {
    return [baseImageId];
  }

  const imageIds = [baseImageId];

  // WADO-URI: ...&frame=N
  if (baseImageId.includes('&frame=') || !baseImageId.includes('/frames/')) {
    for (let frame = 1; frame <= numberOfFrames; frame++) {
      const withoutFrame = baseImageId.split('&frame=')[0];
      imageIds.push(`${withoutFrame}&frame=${frame}`);
    }
    return [...new Set(imageIds)];
  }

  // WADO-RS: .../frames/N
  const frameBase = baseImageId.replace(/\/frames\/\d+$/, '');
  for (let frame = 1; frame <= numberOfFrames; frame++) {
    imageIds.push(`${frameBase}/frames/${frame}`);
  }

  return [...new Set(imageIds)];
}

export function isJpegRenderedImageId(imageId) {
  return (
    typeof imageId === 'string' &&
    (imageId.startsWith('dicomweb-jpeg:') || imageId.includes('contentType=image/jpeg'))
  );
}
