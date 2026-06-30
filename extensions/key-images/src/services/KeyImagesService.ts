import { PubSubService } from '@ohif/core';
import type { KeyImageItem } from '../types';
import { fetchKeyImagesForStudy } from '../utils/keyImagesApi';

export type { KeyImageItem } from '../types';

const EVENTS = {
  KEY_IMAGES_CHANGED: 'event::keyimages:changed',
  KEY_IMAGES_ADDING_CHANGED: 'event::keyimages:addingChanged',
  KEY_IMAGES_LOADING_CHANGED: 'event::keyimages:loadingChanged',
};

export default class KeyImagesService extends PubSubService {
  public static readonly REGISTRATION = {
    name: 'keyImagesService',
    altName: 'KeyImagesService',
    create: () => new KeyImagesService(),
  };

  private _keyImages: KeyImageItem[] = [];
  private _isAddingKeyImage = false;
  private _loadingStudyUID: string | null = null;
  private _loadedStudyUIDs = new Set<string>();

  constructor() {
    super(EVENTS);
    this._clearLegacyStorage();
  }

  public getKeyImages(): KeyImageItem[] {
    return [...this._keyImages];
  }

  public getKeyImagesForStudy(studyInstanceUID?: string | null): KeyImageItem[] {
    if (!studyInstanceUID) {
      return [];
    }

    return this._keyImages.filter(item => item.studyInstanceUID === studyInstanceUID);
  }

  public isAddingKeyImage(): boolean {
    return this._isAddingKeyImage;
  }

  public isLoadingKeyImages(studyInstanceUID?: string | null): boolean {
    if (!studyInstanceUID) {
      return this._loadingStudyUID !== null;
    }

    return this._loadingStudyUID === studyInstanceUID;
  }

  public hasLoadedKeyImagesForStudy(studyInstanceUID?: string | null): boolean {
    if (!studyInstanceUID) {
      return false;
    }

    return this._loadedStudyUIDs.has(studyInstanceUID);
  }

  public setAddingKeyImage(isAdding: boolean): void {
    if (this._isAddingKeyImage === isAdding) {
      return;
    }

    this._isAddingKeyImage = isAdding;
    this._broadcastEvent(EVENTS.KEY_IMAGES_ADDING_CHANGED, { isAdding });
  }

  public findKeyImageForInstance({
    studyInstanceUID,
    imageId,
    sopInstanceUID,
    frameNumber,
  }: {
    studyInstanceUID?: string;
    imageId?: string;
    sopInstanceUID?: string;
    frameNumber?: number | null;
  }): KeyImageItem | undefined {
    const candidates = studyInstanceUID
      ? this.getKeyImagesForStudy(studyInstanceUID)
      : this._keyImages;

    return candidates.find(item => {
      if (imageId && item.imageId === imageId) {
        return true;
      }

      if (sopInstanceUID && item.sopInstanceUID === sopInstanceUID) {
        if (frameNumber != null && item.frameNumber != null) {
          return item.frameNumber === frameNumber;
        }

        return true;
      }

      return false;
    });
  }

  public async loadKeyImagesForStudy(studyInstanceUID: string): Promise<void> {
    if (!studyInstanceUID) {
      return;
    }

    this._loadingStudyUID = studyInstanceUID;
    this._broadcastEvent(EVENTS.KEY_IMAGES_LOADING_CHANGED, {
      loading: true,
      studyInstanceUID,
    });

    try {
      const items = await fetchKeyImagesForStudy(studyInstanceUID);
      this._keyImages = [
        ...this._keyImages.filter(item => item.studyInstanceUID !== studyInstanceUID),
        ...items,
      ];
      this._loadedStudyUIDs.add(studyInstanceUID);
      this._broadcastEvent(EVENTS.KEY_IMAGES_CHANGED, { keyImages: this.getKeyImages() });
    } finally {
      this._loadingStudyUID = null;
      this._broadcastEvent(EVENTS.KEY_IMAGES_LOADING_CHANGED, {
        loading: false,
        studyInstanceUID,
      });
    }
  }

  public setKeyImagesForStudy(studyInstanceUID: string, items: KeyImageItem[]): void {
    this._keyImages = [
      ...this._keyImages.filter(item => item.studyInstanceUID !== studyInstanceUID),
      ...items,
    ];
    this._loadedStudyUIDs.add(studyInstanceUID);
    this._broadcastEvent(EVENTS.KEY_IMAGES_CHANGED, { keyImages: this.getKeyImages() });
  }

  public removeKeyImage(id: string): void {
    const removed = this._keyImages.find(item => item.id === id);
    this._keyImages = this._keyImages.filter(item => item.id !== id);
    this._broadcastEvent(EVENTS.KEY_IMAGES_CHANGED, { keyImages: this.getKeyImages() });

    if (removed?.studyInstanceUID && this.getKeyImagesForStudy(removed.studyInstanceUID).length === 0) {
      this._loadedStudyUIDs.delete(removed.studyInstanceUID);
    }
  }

  public clearKeyImagesForStudy(studyInstanceUID: string): void {
    if (!studyInstanceUID) {
      return;
    }

    this._keyImages = this._keyImages.filter(item => item.studyInstanceUID !== studyInstanceUID);
    this._loadedStudyUIDs.delete(studyInstanceUID);
    this._broadcastEvent(EVENTS.KEY_IMAGES_CHANGED, { keyImages: this.getKeyImages() });
  }

  private _clearLegacyStorage(): void {
    if (typeof window === 'undefined') {
      return;
    }

    try {
      window.localStorage.removeItem('ohif.keyImages');
    } catch {
      // Best effort cleanup only.
    }
  }
}
