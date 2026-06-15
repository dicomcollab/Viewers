import {
  captureViewportImage,
  fetchJpegBlobFromImageId,
  isJpegWadoUriImageId,
} from '@ohif/extension-cornerstone';
import { isJpegDataSourceActive } from './isJpegDataSourceActive';

type CaptureKeyImageOptions = {
  imageId?: string;
  activeViewportId: string;
  cornerstoneViewportService: unknown;
  extensionManager?: {
    activeDataSourceName?: string;
    getActiveDataSourceDefinition?: () => { sourceName?: string };
    getActiveDataSource?: () => Array<{ name?: string; sourceName?: string }>;
  };
};

type CaptureKeyImageResult = {
  dataUrl: string;
  blob: Blob | null;
  mimeType: string;
};

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read image blob'));
    reader.readAsDataURL(blob);
  });
}

function isDicomWebImageId(imageId: string): boolean {
  return imageId.startsWith('dicomweb:') || imageId.startsWith('dicomweb-jpeg:');
}

function shouldUseOriginalJpeg(
  imageId: string | undefined,
  extensionManager?: CaptureKeyImageOptions['extensionManager']
): imageId is string {
  if (!imageId || !isDicomWebImageId(imageId)) {
    return false;
  }

  if (imageId.startsWith('dicomweb-jpeg:') || isJpegWadoUriImageId(imageId)) {
    return true;
  }

  return isJpegDataSourceActive(extensionManager);
}

export async function captureKeyImage({
  imageId,
  activeViewportId,
  cornerstoneViewportService,
  extensionManager,
}: CaptureKeyImageOptions): Promise<CaptureKeyImageResult> {
  if (shouldUseOriginalJpeg(imageId, extensionManager)) {
    const blob = await fetchJpegBlobFromImageId(imageId);
    const dataUrl = await blobToDataUrl(blob);
    return {
      dataUrl,
      blob,
      mimeType: blob.type || 'image/jpeg',
    };
  }

  const capture = await captureViewportImage({
    activeViewportId,
    cornerstoneViewportService,
    showAnnotations: true,
    fileType: 'png',
  });

  return {
    dataUrl: capture.dataUrl,
    blob: capture.blob,
    mimeType: capture.mimeType,
  };
}

export async function resolveKeyImageUploadBlob(
  item: {
    blob?: Blob | null;
    dataUrl?: string;
    imageId?: string;
  },
  extensionManager?: CaptureKeyImageOptions['extensionManager']
): Promise<Blob | null> {
  if (item.blob) {
    return item.blob;
  }

  if (shouldUseOriginalJpeg(item.imageId, extensionManager)) {
    try {
      return await fetchJpegBlobFromImageId(item.imageId);
    } catch {
      // Fall through to dataUrl conversion below.
    }
  }

  if (item.dataUrl) {
    const response = await fetch(item.dataUrl);
    return response.blob();
  }

  return null;
}

export function getKeyImageUploadFileName(item: { id: string }, blob: Blob): string {
  const isJpeg = blob.type === 'image/jpeg' || blob.type === 'image/jpg';
  return `${item.id}.${isJpeg ? 'jpg' : 'png'}`;
}
