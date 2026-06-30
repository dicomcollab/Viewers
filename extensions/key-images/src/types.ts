export type KeyImageItem = {
  id: string;
  s3Key?: string;
  imageId?: string;
  imageIndex?: number;
  viewportId?: string;
  studyInstanceUID?: string;
  seriesInstanceUID?: string;
  sopInstanceUID?: string;
  frameNumber?: number | null;
  createdAt: number;
  dataUrl?: string;
  url?: string;
  blob?: Blob | null;
  measurements?: unknown[];
};
