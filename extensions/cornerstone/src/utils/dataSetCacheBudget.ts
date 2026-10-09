import { eventTarget, getRenderingEngines } from '@cornerstonejs/core';
import dicomImageLoader from '@cornerstonejs/dicom-image-loader';

/**
 * The dicom-image-loader keeps every downloaded DICOM file (whole original-syntax
 * instances, WADO-URI files) while any of its frames is in the image cache. Those
 * bytes are outside the Cornerstone cache budget, so a study with many clips held
 * the compressed copy of every clip on top of the decoded frames. Past the budget,
 * the files of clips not on screen are released, oldest first. Their decoded frames
 * stay cached; a frame decoded later downloads the file again.
 */

const MB = 1024 * 1024;
const DEFAULT_BUDGET_MB = 512;
const EVICT_TARGET_FRACTION = 0.8;
/** Frames of a file still queued in the request pool decode from it in this window. */
const MIN_RESIDENT_MS = 30_000;
const DATASETS_CACHE_CHANGED = 'datasetscachechanged';

type DataSetCacheManager = {
  isLoaded: (uri: string) => boolean;
  unload: (uri: string) => void;
  getInfo: () => { cacheSizeInBytes: number };
};

type DataSetsCacheChangedDetail = {
  uri?: string;
  action?: 'loaded' | 'updated' | 'unloaded';
  cacheInfo?: { cacheSizeInBytes?: number };
};

let installed = false;
let budgetBytes = DEFAULT_BUDGET_MB * MB;
const loadedAt = new Map<string, number>();

function getManager(): DataSetCacheManager | null {
  return (
    (dicomImageLoader as unknown as { wadouri?: { dataSetCacheManager?: DataSetCacheManager } })
      ?.wadouri?.dataSetCacheManager ?? null
  );
}

/** File URL prefixes of the frames on screen (WADO-RS instance URL or WADO-URI file URL). */
function getOnScreenFilePrefixes(): string[] {
  const prefixes: string[] = [];
  try {
    getRenderingEngines().forEach(engine => {
      if (engine.hasBeenDestroyed) {
        return;
      }
      engine.getViewports().forEach(viewport => {
        const imageId = (viewport as { getCurrentImageId?: () => string }).getCurrentImageId?.();
        if (!imageId) {
          return;
        }
        const url = imageId.replace(/^[a-z-]+:/i, '');
        const framesAt = url.indexOf('/frames/');
        prefixes.push(framesAt === -1 ? url.replace(/&frame=\d+/i, '') : url.slice(0, framesAt));
      });
    });
  } catch {
    // Rendering engine mid-teardown.
  }
  return prefixes;
}

function releaseFile(manager: DataSetCacheManager, uri: string): void {
  // unload() only drops the file once every frame that loaded it has let go.
  let guard = 100_000;
  while (manager.isLoaded(uri) && guard > 0) {
    manager.unload(uri);
    guard -= 1;
  }
  loadedAt.delete(uri);
}

function enforceBudget(manager: DataSetCacheManager): void {
  if (manager.getInfo().cacheSizeInBytes <= budgetBytes) {
    return;
  }

  const target = budgetBytes * EVICT_TARGET_FRACTION;
  const onScreen = getOnScreenFilePrefixes();
  const residentSince = Date.now() - MIN_RESIDENT_MS;
  const oldestFirst = Array.from(loadedAt.entries())
    .filter(([, time]) => time <= residentSince)
    .sort((a, b) => a[1] - b[1])
    .map(([uri]) => uri);

  for (const uri of oldestFirst) {
    if (manager.getInfo().cacheSizeInBytes <= target) {
      return;
    }
    if (onScreen.some(prefix => uri.startsWith(prefix))) {
      continue;
    }
    releaseFile(manager, uri);
  }
}

function onDataSetsCacheChanged(event: Event): void {
  const { uri, action } = ((event as CustomEvent).detail ?? {}) as DataSetsCacheChangedDetail;
  if (!uri) {
    return;
  }
  if (action === 'unloaded') {
    loadedAt.delete(uri);
    return;
  }
  if (action !== 'loaded') {
    return;
  }

  loadedAt.set(uri, Date.now());
  const manager = getManager();
  if (manager) {
    enforceBudget(manager);
  }
}

/** Study switch: the purged files are gone, forget their load times. */
function resetDataSetCacheBudget(): void {
  loadedAt.clear();
}

function installDataSetCacheBudget(maxSizeMB?: number): void {
  budgetBytes = (Number(maxSizeMB) > 0 ? Number(maxSizeMB) : DEFAULT_BUDGET_MB) * MB;
  if (installed || !getManager()) {
    return;
  }
  installed = true;
  eventTarget.addEventListener(DATASETS_CACHE_CHANGED, onDataSetsCacheChanged);
}

export { installDataSetCacheBudget, resetDataSetCacheBudget };
