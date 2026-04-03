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
  public static readonly REGISTRATION = {
    name: 'keyImagesService',
    altName: 'KeyImagesService',
    create: () => new KeyImagesService(),
  };

  private _keyImages: KeyImageItem[] = [];

  constructor() {
    super(EVENTS);
  }

  public getKeyImages(): KeyImageItem[] {
    return [...this._keyImages];
  }

  public addKeyImage(keyImage: KeyImageItem): void {
    this._keyImages = [keyImage, ...this._keyImages];
    this._broadcastEvent(EVENTS.KEY_IMAGES_CHANGED, { keyImages: this.getKeyImages() });
  }

  public removeKeyImage(id: string): void {
    this._keyImages = this._keyImages.filter(item => item.id !== id);
    this._broadcastEvent(EVENTS.KEY_IMAGES_CHANGED, { keyImages: this.getKeyImages() });
  }

  public clearKeyImages(): void {
    this._keyImages = [];
    this._broadcastEvent(EVENTS.KEY_IMAGES_CHANGED, { keyImages: [] });
  }
}
