/**
 * Align Cornerstone image.numberOfComponents with the loaded pixel buffer.
 * Prevents VTK errors: "model.size is not a multiple of model.numberOfComponents"
 * when DICOM metadata (e.g. RGB / PALETTE COLOR) disagrees with decoded pixels.
 */
export function syncImageNumberOfComponents(image) {
  if (!image?.rows || !image?.columns) {
    return image;
  }

  const rows = image.rows;
  const columns = image.columns;
  const numPixels = rows * columns;

  if (!numPixels) {
    return image;
  }

  const pixelData =
    typeof image.voxelManager?.getScalarData === 'function'
      ? image.voxelManager.getScalarData()
      : typeof image.getPixelData === 'function'
        ? image.getPixelData()
        : null;

  if (!pixelData?.length) {
    return image;
  }

  const bitsAllocated = image.bitsAllocated || 8;
  const bytesPerSample = bitsAllocated <= 8 ? 1 : bitsAllocated <= 16 ? 2 : 4;
  const bytesPerPixel = pixelData.length / numPixels;

  if (!Number.isFinite(bytesPerPixel) || bytesPerPixel < 1) {
    return image;
  }

  let samplesPerPixel = image.samplesPerPixel;

  // 8-bit interleaved RGB(A)
  if (bytesPerPixel === 3) {
    samplesPerPixel = 3;
  } else if (bytesPerPixel === 4 && bitsAllocated <= 8) {
    samplesPerPixel = 3;
    image.rgba = true;
  } else if (Number.isInteger(bytesPerPixel / bytesPerSample)) {
    samplesPerPixel = bytesPerPixel / bytesPerSample;
  } else if (bytesPerPixel === 1) {
    samplesPerPixel = 1;
  }

  if (!samplesPerPixel || samplesPerPixel < 1) {
    samplesPerPixel = 1;
  }

  image.samplesPerPixel = samplesPerPixel;
  image.numberOfComponents = samplesPerPixel;
  image.color = samplesPerPixel > 1;

  if (samplesPerPixel === 3) {
    image.photometricInterpretation = image.photometricInterpretation || 'RGB';
  } else if (samplesPerPixel === 1) {
    image.photometricInterpretation = image.photometricInterpretation || 'MONOCHROME2';
  }

  return image;
}
