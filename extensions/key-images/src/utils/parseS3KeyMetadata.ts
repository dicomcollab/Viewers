function stripImageExtension(value: string): string {
  return value.replace(/\.(png|jpe?g|gif|webp)$/i, '');
}

/**
 * S3 keys are typically:
 *   .../{studyInstanceUID}/{seriesInstanceUID}/{imageIndex}_{sopInstanceUID}_{id}.ext
 * Series UID is the parent folder of the file (not a fixed path index).
 */
export function parseS3KeyMetadata(s3Key: string): {
  seriesInstanceUID?: string;
  sopInstanceUID?: string;
  imageIndex?: number;
} {
  const segments = s3Key.split('/').filter(Boolean);
  if (segments.length < 2) {
    return {};
  }

  // Parent folder of the object is the series UID in the upload layout.
  const seriesInstanceUID = segments.length >= 2 ? segments[segments.length - 2] : undefined;
  const fileName = segments[segments.length - 1] || '';
  const underscoreIndex = fileName.indexOf('_');
  if (underscoreIndex <= 0) {
    return { seriesInstanceUID };
  }

  const imageIndexRaw = fileName.slice(0, underscoreIndex);
  const remainder = fileName.slice(underscoreIndex + 1);
  const secondUnderscore = remainder.indexOf('_');
  const sopRaw =
    secondUnderscore > 0 ? remainder.slice(0, secondUnderscore) : stripImageExtension(remainder);
  const sopInstanceUID = stripImageExtension(sopRaw);
  const imageIndex =
    imageIndexRaw !== 'unknownIndex' && Number.isFinite(Number(imageIndexRaw))
      ? Number(imageIndexRaw)
      : undefined;

  return {
    seriesInstanceUID,
    sopInstanceUID:
      sopInstanceUID && sopInstanceUID !== 'unknownSopUID' ? sopInstanceUID : undefined,
    imageIndex,
  };
}
