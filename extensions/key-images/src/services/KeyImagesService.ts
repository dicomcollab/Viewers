import { PubSubService } from '@ohif/core';

export type KeyImageItem = {
  id: string;
  imageId?: string;
  imageIndex?: number;
  viewportId?: string;
  studyInstanceUID?: string;
  seriesInstanceUID?: string;
  sopInstanceUID?: string;
  frameNumber?: number | null;
  createdAt: number;
  dataUrl: string;
  blob?: Blob | null;
  measurements?: unknown[];
};

const EVENTS = {
  KEY_IMAGES_CHANGED: 'event::keyimages:changed',
};

export default class KeyImagesService extends PubSubService {
  private static readonly STORAGE_KEY = 'ohif.keyImages';
  public static readonly REGISTRATION = {
    name: 'keyImagesService',
    altName: 'KeyImagesService',
    create: () => new KeyImagesService(),
  };

  private _keyImages: KeyImageItem[] = [];

  constructor() {
    super(EVENTS);
    this._keyImages = this._loadFromStorage();
  }

  public getKeyImages(): KeyImageItem[] {
    return [...this._keyImages];
  }

  public addKeyImage(keyImage: KeyImageItem): void {
    this._keyImages = [keyImage, ...this._keyImages];
    this._persistToStorage();
    this._broadcastEvent(EVENTS.KEY_IMAGES_CHANGED, { keyImages: this.getKeyImages() });
  }

  public removeKeyImage(id: string): void {
    this._keyImages = this._keyImages.filter(item => item.id !== id);
    this._persistToStorage();
    this._broadcastEvent(EVENTS.KEY_IMAGES_CHANGED, { keyImages: this.getKeyImages() });
  }

  public clearKeyImages(): void {
    this._keyImages = [];
    this._persistToStorage();
    this._broadcastEvent(EVENTS.KEY_IMAGES_CHANGED, { keyImages: [] });
  }

  private _persistToStorage(): void {
    if (typeof window === 'undefined') {
      return;
    }

    try {
      const serializableItems = this._keyImages.map(item => ({
        ...item,
        // Blob is not JSON serializable; image is restored from dataUrl.
        blob: null,
      }));
      window.localStorage.setItem(
        KeyImagesService.STORAGE_KEY,
        JSON.stringify(serializableItems)
      );
    } catch {
      // Best effort persistence only.
    }
  }

  private _loadFromStorage(): KeyImageItem[] {
    if (typeof window === 'undefined') {
      return [];
    }

    try {
      const raw = window.localStorage.getItem(KeyImagesService.STORAGE_KEY);
      if (!raw) {
        return [];
      }

      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        return [];
      }

      return parsed
        .filter(item => item && typeof item.id === 'string' && typeof item.dataUrl === 'string')
        .map(item => ({
          ...item,
          createdAt: Number(item.createdAt) || Date.now(),
          blob: null,
        }));
    } catch {
      return [];
    }
  }
}
