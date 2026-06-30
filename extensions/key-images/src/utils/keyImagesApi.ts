import type { KeyImageItem } from '../types';
import { getKeyImagesAuthHeader } from './getKeyImagesAuthHeader';
import {
  getKeyImageUploadFileName,
  resolveKeyImageUploadBlob,
} from './captureKeyImage';

type RisKeyImageApiItem = {
  key: string;
  size?: number;
  lastModified?: string;
  url?: string;
};

type RisKeyImagesListResponse = {
  error?: boolean;
  message?: string;
  data?: {
    studyInstanceUID: string;
    prefix: string;
    count: number;
    items: RisKeyImageApiItem[];
  };
};

type ExtensionManagerLike = {
  activeDataSourceName?: string;
  getActiveDataSourceDefinition?: () => { sourceName?: string };
  getActiveDataSource?: () => Array<{ name?: string; sourceName?: string }>;
};

function getAppConfig() {
  return typeof window !== 'undefined'
    ? (window.config as Parameters<typeof getKeyImagesAuthHeader>[0] & {
        keyImagesUploadUrl?: string;
        risApiBase?: string;
      })
    : undefined;
}

export function getKeyImagesUserApiBase(): string {
  const config = getAppConfig();
  const uploadUrl = config?.keyImagesUploadUrl?.trim();
  if (uploadUrl) {
    return uploadUrl.replace(/\/upload\/?$/, '');
  }

  const risApiBase = config?.risApiBase?.replace(/\/$/, '');
  if (risApiBase) {
    return `${risApiBase}/api/v1/key-images-user`;
  }

  return '';
}

function getAuthHeaders(): Record<string, string> {
  const authHeaders = getKeyImagesAuthHeader(getAppConfig());
  if (!authHeaders?.Authorization && !authHeaders?.token) {
    throw new Error(
      'Missing API credentials. Sign in to RIS or open the viewer from an authenticated session.'
    );
  }
  return authHeaders;
}

function parseS3KeyMetadata(s3Key: string): {
  seriesInstanceUID?: string;
  sopInstanceUID?: string;
  imageIndex?: number;
} {
  const segments = s3Key.split('/').filter(Boolean);
  if (segments.length < 2) {
    return {};
  }

  const seriesInstanceUID = segments.length >= 5 ? segments[4] : undefined;
  const fileName = segments[segments.length - 1] || '';
  const underscoreIndex = fileName.indexOf('_');
  if (underscoreIndex <= 0) {
    return { seriesInstanceUID };
  }

  const imageIndexRaw = fileName.slice(0, underscoreIndex);
  const remainder = fileName.slice(underscoreIndex + 1);
  const secondUnderscore = remainder.indexOf('_');
  if (secondUnderscore <= 0) {
    return { seriesInstanceUID };
  }

  const sopInstanceUID = remainder.slice(0, secondUnderscore);
  const imageIndex =
    imageIndexRaw !== 'unknownIndex' && Number.isFinite(Number(imageIndexRaw))
      ? Number(imageIndexRaw)
      : undefined;

  return {
    seriesInstanceUID,
    sopInstanceUID: sopInstanceUID !== 'unknownSopUID' ? sopInstanceUID : undefined,
    imageIndex,
  };
}

export function mapRisItemToKeyImageItem(
  item: RisKeyImageApiItem,
  studyInstanceUID: string
): KeyImageItem {
  const metadata = parseS3KeyMetadata(item.key);

  return {
    id: item.key,
    s3Key: item.key,
    studyInstanceUID,
    seriesInstanceUID: metadata.seriesInstanceUID,
    sopInstanceUID: metadata.sopInstanceUID,
    imageIndex: metadata.imageIndex,
    createdAt: item.lastModified ? new Date(item.lastModified).getTime() : Date.now(),
    url: item.url,
    dataUrl: item.url,
    blob: null,
    measurements: [],
  };
}

export async function fetchKeyImagesForStudy(studyInstanceUID: string): Promise<KeyImageItem[]> {
  const apiBase = getKeyImagesUserApiBase();
  if (!apiBase) {
    throw new Error('Missing key images API configuration.');
  }

  const response = await fetch(
    `${apiBase}/${encodeURIComponent(studyInstanceUID)}?includeSignedUrl=true`,
    {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        ...getAuthHeaders(),
      },
    }
  );

  if (!response.ok) {
    let detail = '';
    try {
      detail = await response.text();
    } catch {
      /* ignore */
    }
    throw new Error(
      `Failed to load key images (${response.status})${detail ? `: ${detail}` : ''}`
    );
  }

  const payload = (await response.json()) as RisKeyImagesListResponse;
  const items = Array.isArray(payload?.data?.items) ? payload.data.items : [];
  return items.map(item => mapRisItemToKeyImageItem(item, studyInstanceUID));
}

export async function deleteKeyImageFromRis(
  studyInstanceUID: string,
  s3Key: string
): Promise<void> {
  const apiBase = getKeyImagesUserApiBase();
  if (!apiBase) {
    throw new Error('Missing key images API configuration.');
  }

  const response = await fetch(`${apiBase}/${encodeURIComponent(studyInstanceUID)}`, {
    method: 'DELETE',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...getAuthHeaders(),
    },
    body: JSON.stringify({ key: s3Key }),
  });

  if (!response.ok) {
    let detail = '';
    try {
      detail = await response.text();
    } catch {
      /* ignore */
    }
    throw new Error(
      `Failed to delete key image (${response.status})${detail ? `: ${detail}` : ''}`
    );
  }
}

export async function uploadKeyImagesToRis(
  keyImages: KeyImageItem[],
  extensionManager?: ExtensionManagerLike
): Promise<void> {
  const keyImagesUploadUrl = getAppConfig()?.keyImagesUploadUrl;
  if (!keyImagesUploadUrl) {
    throw new Error('Missing keyImagesUploadUrl in config.');
  }

  if (!keyImages.length) {
    throw new Error('No key images to upload.');
  }

  const activeStudyUID = keyImages[0]?.studyInstanceUID;
  if (!activeStudyUID) {
    throw new Error('Missing studyInstanceUID for key image upload.');
  }

  const metadata = {
    createdAt: new Date().toISOString(),
    studyInstanceUID: activeStudyUID,
    reportContextId: new URLSearchParams(window.location.search).get('reportContextId') || null,
    tempId: new URLSearchParams(window.location.search).get('tempId') || null,
    keyImages: keyImages.map(item => ({
      id: item.id,
      imageId: item.imageId,
      imageIndex: item.imageIndex,
      studyInstanceUID: item.studyInstanceUID,
      seriesInstanceUID: item.seriesInstanceUID,
      sopInstanceUID: item.sopInstanceUID,
      frameNumber: item.frameNumber,
      createdAt: item.createdAt,
      measurements: item.measurements || [],
    })),
  };

  const formData = new FormData();
  formData.append('metadata', JSON.stringify(metadata));

  for (let i = 0; i < keyImages.length; i++) {
    const item = keyImages[i];
    const fileBlob = await resolveKeyImageUploadBlob(item, extensionManager);

    if (fileBlob) {
      formData.append('files', fileBlob, getKeyImageUploadFileName(item, fileBlob));
    }
  }

  const response = await fetch(keyImagesUploadUrl, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: formData,
  });

  if (!response.ok) {
    let detail = '';
    try {
      detail = await response.text();
    } catch {
      /* ignore */
    }
    throw new Error(
      `Upload failed with status ${response.status}${detail ? `: ${detail}` : ''}`
    );
  }
}
