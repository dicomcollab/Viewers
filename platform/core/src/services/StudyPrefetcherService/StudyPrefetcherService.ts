import { PubSubService } from '../_shared/pubSubServiceInterface';
import { ExtensionManager } from '../../extensions';
import ServicesManager from '../ServicesManager';
import ViewportGridService from '../ViewportGridService';
import { DisplaySet } from '../../types';
import { getStudyPanelNavigationOrder } from '../../utils/studyPanelNavigationOrder';

enum RequestType {
  /** Highest priority for loading*/
  Interaction = 'interaction',
  /** Second highest priority for loading*/
  Thumbnail = 'thumbnail',
  /** Third highest priority for loading, usually used for image loading in the background*/
  Prefetch = 'prefetch',
  /** Lower priority, often used for background computations in the worker */
  Compute = 'compute',
}

export const EVENTS = {
  SERVICE_STARTED: 'event::studyPrefetcherService:started',
  SERVICE_STOPPED: 'event::studyPrefetcherService:stopped',
  DISPLAYSET_LOAD_PROGRESS: 'event::studyPrefetcherService:displaySetLoadProgress',
  DISPLAYSET_LOAD_COMPLETE: 'event::studyPrefetcherService:displaySetLoadComplete',
};

/**
 * Order used for prefetching display set
 */
enum StudyPrefetchOrder {
  closest = 'closest',
  downward = 'downward',
  upward = 'upward',
}

/**
 * Study Prefetcher configuration
 */
type StudyPrefetcherConfig = {
  /* Enable/disable study prefetching service */
  enabled: boolean;
  /* Number of displaysets to be prefetched */
  displaySetsCount: number;
  /**
   * Max number of concurrent prefetch requests
   * High numbers may impact on the time to load a new dropped series because
   * the browser will be busy with all prefetching requests. As soon as the
   * prefetch requests get fulfilled the new ones from the new dropped series
   * are sent to the server.
   *
   * TODO: abort all prefetch requests when a new series is loaded on a viewport.
   * (need to add support for `AbortController` on Cornerstone)
   * */
  maxNumPrefetchRequests: number;
  /* Display sets prefetching order (closest, downward and upward) */
  order: StudyPrefetchOrder;
  /**
   * Automatic (look-ahead) prefetch loads only the first N frames of each display
   * set, enough to show it and start its cine. User-requested prefetches load
   * these first for every display set, then the remaining frames. 0 = no cap.
   */
  maxImagesPerDisplaySetToPrefetch?: number;
  /** Automatic prefetch walks every display set of the study instead of `displaySetsCount`. */
  prefetchAllSeries?: boolean;
  /**
   * Share of the decoded-image cache that prefetched (not yet viewed) frames may
   * occupy. Past it prefetching stops, so it never evicts what it just loaded.
   */
  maxCacheFraction?: number;
};

type DisplaySetLoadingState = {
  displaySetInstanceUID: string;
  numInstances: number;
  pendingImageIds: Set<string>;
  loadedImageIds: Set<string>;
  failedImageIds: Set<string>;
  loadingProgress: number;
  /**
   * Streaming volumes (MPR/orthographic) often do not register every slice in
   * `cache.getImageLoadObject` until load completes; Cornerstone reports frame
   * progress via `IMAGE_VOLUME_MODIFIED` instead.
   */
  volumeStreamProgress?: {
    framesProcessed: number;
    numberOfFrames: number;
  };
};

type ImageRequest = {
  displaySetInstanceUID: string;
  imageId: string;
  aborted: boolean;
  /** Handed to the network by the request pool (a queued one may be dropped unsent). */
  started?: boolean;
};

export type StudyPrefetcherStats = {
  sent: number;
  loaded: number;
  failed: number;
  /** Requests of a stopped run still downloading; they count against the concurrency cap. */
  orphanedInflight: number;
  inflight: number;
  pending: number;
  paused: string[];
  /** True while cine is playing: prefetch concurrency capped at 1. */
  smoothPlaybackMode?: boolean;
  prefetchResidentBytes: number;
  prefetchBudgetBytes: number;
  haltedForMemory: number;
  completedInvalidatedByEviction: number;
};

/** Frames a viewport has decoded for the display set it shows (e.g. a US clip). */
type ViewportDownloadProgress = {
  loaded: number;
  total: number;
  failed: number;
};

export type DisplaySetDownloadProgress = {
  loadingProgress: number;
  numInstances: number;
  /** Show the instance download bar on the study panel thumbnail. */
  showStudyPanelProgress: boolean;
  failed: number;
};

export type StudyDownloadProgress = {
  /** Image display sets of the study that are fully downloaded. */
  downloaded: number;
  total: number;
  /** A user-requested study/series prefetch is still queued or downloading. */
  isPrefetching: boolean;
  /** Frames (instances) downloaded across the study, for a live progress bar. */
  loadedFrames: number;
  totalFrames: number;
};

const NO_IMAGE_MODALITIES = ['SR', 'SEG', 'RTSTRUCT', 'RTPLAN', 'RTDOSE', 'DOC', 'PMAP'];

type PubSubServiceSubscription = { unsubscribe: () => any };

interface ICache {
  /** Decoded and resident in the image cache (a download in progress is not cached). */
  isImageCached(imageId: string): boolean;
  /** A load for the image is in progress (fetching or decoding). */
  isImageLoading?(imageId: string): boolean;
  getImageSizeInBytes?(imageId: string): number;
  getMaxCacheSizeInBytes?(): number;
}

interface IImageLoadPoolManager {
  addRequest(
    requestFn: () => Promise<any>,
    type: string,
    additionalDetails: Record<string, unknown>,
    priority?: number
  );
  clearRequestStack(type: string): void;
}

interface IImageLoader {
  loadAndCacheImage(imageId: string, options: any): Promise<any>;
}

type EventSubscription = {
  unsubscribe: () => void;
};

interface IImageLoadEventsManager {
  addEventListeners(
    onImageLoaded: (evt: any) => void,
    onImageLoadFailed: (evt: any) => void
  ): EventSubscription[];
}

class StudyPrefetcherService extends PubSubService {
  private _extensionManager: ExtensionManager;
  private _servicesManager: ServicesManager;
  private _subscriptions: PubSubServiceSubscription[];
  private _activeDisplaySetsInstanceUIDs: string[] = [];
  private _pendingRequests: ImageRequest[] = [];
  private _inflightRequests = new Map<string, ImageRequest>();
  private _isRunning = false;
  /** Why new requests are held (e.g. visible clips downloading, a page still binding). */
  private _pauseReasons = new Set<string>();
  /**
   * While on-screen cine is playing, only one prefetch request may run so decode
   * / network capacity stays with the playing tiles (smooth playback).
   */
  private _smoothPlaybackMode = false;
  /** Started requests of a stopped run that have not settled yet. */
  private _orphanedInflight = 0;
  /** Decoded bytes of frames this service loaded that are still in the image cache. */
  private _prefetchResidentBytes = new Map<string, number>();
  private _prefetchResidentTotal = 0;
  /** imageId -> completed display set, so an eviction can withdraw the completion. */
  private _completedImageIds = new Map<string, string>();
  private _stats = {
    sent: 0,
    loaded: 0,
    failed: 0,
    haltedForMemory: 0,
    completedInvalidatedByEviction: 0,
  };
  private _displaySetLoadingStates = new Map<string, DisplaySetLoadingState>();
  /** Display sets for which the study panel should show instance download progress (user clicked Preload). */
  private _studyPanelProgressDisplaySetUIDs = new Set<string>();
  /**
   * Series/study prefetches the user asked for, most recent first. Survives
   * prefetcher restarts (active viewport / layout changes) until downloaded.
   */
  private _userRequestedDisplaySetUIDs: string[] = [];
  private _viewportDownloadProgress = new Map<string, ViewportDownloadProgress>();
  private _imageIdsToDisplaySetsMap = new Map<string, Set<string>>();
  /**
   * Display sets whose every instance is decoded in the image cache, with their
   * instance count. Survives prefetcher restarts; an eviction of any of their
   * frames withdraws it (see notifyImageEvicted).
   */
  private _completedDisplaySets = new Map<string, number>();
  /**
   * High-water mark of frames downloaded at least once per display set. Survives
   * page changes (viewport progress cleared), prefetch restarts (loading state
   * cleared), and cache eviction — so "Downloading study N/M frames" never jumps
   * backward when the user pages the layout.
   */
  private _knownDownloadedFrames = new Map<string, { loaded: number; total: number }>();
  /** Studies the user asked to download as a whole. */
  private _requestedStudyUIDs = new Set<string>();
  private config: StudyPrefetcherConfig = {
    /* Enable/disable study prefetching service */
    enabled: false,
    /* Number of displaysets to be prefetched */
    displaySetsCount: 1,
    /**
     * Max number of concurrent prefetch requests
     * High numbers may impact on the time to load a new dropped series because
     * the browser will be busy with all prefetching requests. As soon as the
     * prefetch requests get fulfilled the new ones from the new dropped series
     * are sent to the server.
     *
     * TODO: abort all prefetch requests when a new series is loaded on a viewport.
     * (need to add support for `AbortController` on Cornerstone)
     * */
    maxNumPrefetchRequests: 10,
    /* Display sets prefetching order (closest, downward and upward) */
    order: StudyPrefetchOrder.downward,
    maxImagesPerDisplaySetToPrefetch: 0,
    prefetchAllSeries: false,
    maxCacheFraction: 0.5,
  };

  // Properties set by Cornerstone extension (initStudyPrefetcherService)
  public requestType: string = RequestType.Prefetch;
  public cache: ICache;
  public imageLoadPoolManager: IImageLoadPoolManager;
  public imageLoader: IImageLoader;
  public imageLoadEventsManager: IImageLoadEventsManager;

  public static REGISTRATION = {
    name: 'studyPrefetcherService',
    altName: 'StudyPrefetcherService',
    create: ({ configuration, servicesManager, extensionManager }): StudyPrefetcherService => {
      return new StudyPrefetcherService({
        servicesManager,
        extensionManager,
        configuration,
      });
    },
  };

  constructor({
    servicesManager,
    extensionManager,
    configuration,
  }: {
    servicesManager: ServicesManager;
    extensionManager: ExtensionManager;
    configuration: StudyPrefetcherConfig;
  }) {
    super(EVENTS);

    this._servicesManager = servicesManager;
    this._extensionManager = extensionManager;
    this._subscriptions = [];

    Object.assign(this.config, configuration);
  }

  public onModeEnter(): void {
    this._addEventListeners();
  }

  /**
   * The onModeExit returns the service to the initial state.
   */
  public onModeExit(): void {
    this._removeEventListeners();
    this._stopPrefetching();
    this._pauseReasons.clear();
    this._smoothPlaybackMode = false;
    this._userRequestedDisplaySetUIDs = [];
    this._viewportDownloadProgress.clear();
    this._knownDownloadedFrames.clear();
    this._completedDisplaySets.clear();
    this._completedImageIds.clear();
    this._prefetchResidentBytes.clear();
    this._prefetchResidentTotal = 0;
    this._requestedStudyUIDs.clear();
  }

  /**
   * Hold new prefetch requests (e.g. while visible ultrasound clips download)
   * without discarding the queue or load progress. In-flight requests finish.
   * Each `reason` pauses independently; requests resume once none is left.
   */
  public setPaused(paused: boolean, reason = 'default'): void {
    const wasPaused = this._pauseReasons.size > 0;

    if (paused) {
      this._pauseReasons.add(reason);
    } else {
      this._pauseReasons.delete(reason);
    }

    if (wasPaused && !this._pauseReasons.size) {
      this._sendNextRequests();
    }
  }

  public isPaused(): boolean {
    return this._pauseReasons.size > 0;
  }

  /**
   * Prefer smooth on-screen cine over background study download: at most one
   * prefetch request at a time. Cleared when no visible tile is playing.
   */
  public setSmoothPlaybackMode(enabled: boolean): void {
    const next = Boolean(enabled);
    if (this._smoothPlaybackMode === next) {
      return;
    }
    this._smoothPlaybackMode = next;
    if (!next) {
      this._sendNextRequests();
    }
  }

  public isSmoothPlaybackMode(): boolean {
    return this._smoothPlaybackMode;
  }

  /**
   * A decoded frame left the image cache. Prefetch may fetch it again. Study-
   * panel "downloaded" progress for on-screen clips stays with viewport
   * progress (downloaded at least once) so eviction does not blink the bar.
   */
  public notifyImageEvicted(imageId: string): void {
    const bytes = this._prefetchResidentBytes.get(imageId);
    if (bytes != null) {
      this._prefetchResidentBytes.delete(imageId);
      this._prefetchResidentTotal = Math.max(0, this._prefetchResidentTotal - bytes);
    }

    const displaySetInstanceUID = this._completedImageIds.get(imageId);
    if (!displaySetInstanceUID) {
      return;
    }

    const viewportProgress = this._viewportDownloadProgress.get(displaySetInstanceUID);
    const clipStillReportsComplete =
      viewportProgress != null &&
      viewportProgress.total > 0 &&
      viewportProgress.loaded >= viewportProgress.total;

    // On-screen US clips already finished downloading once: keep "completed"
    // for the panel. Still re-open prefetch bookkeeping for the lost frame.
    if (!clipStillReportsComplete) {
      this._completedDisplaySets.delete(displaySetInstanceUID);
      this._completedImageIds.forEach((uid, id) => {
        if (uid === displaySetInstanceUID) {
          this._completedImageIds.delete(id);
        }
      });
      this._stats.completedInvalidatedByEviction += 1;
    } else {
      this._completedImageIds.delete(imageId);
    }

    const state = this._displaySetLoadingStates.get(displaySetInstanceUID);
    if (state && state.loadedImageIds.delete(imageId)) {
      state.pendingImageIds.add(imageId);
      this._updateDisplaySetLoadingProgress(state);
    }
    this._triggerDisplaySetEvents(displaySetInstanceUID);
  }

  public getStats(): StudyPrefetcherStats {
    return {
      ...this._stats,
      orphanedInflight: this._orphanedInflight,
      inflight: this._inflightRequests.size,
      pending: this._pendingRequests.length,
      paused: Array.from(this._pauseReasons),
      smoothPlaybackMode: this._smoothPlaybackMode,
      prefetchResidentBytes: this._prefetchResidentTotal,
      prefetchBudgetBytes: this._getPrefetchBudgetBytes(),
    };
  }

  /**
   * Raise the durable "downloaded at least once" count for a display set.
   * Never decreases — page changes and cache eviction must not undo the study total.
   */
  private _recordKnownDownloadedFrames(
    displaySetInstanceUID: string,
    loaded: number,
    total: number
  ): void {
    if (!displaySetInstanceUID || !(total > 0) || !(loaded >= 0)) {
      return;
    }
    const safeTotal = Math.max(1, Math.floor(total));
    const safeLoaded = Math.max(0, Math.min(safeTotal, Math.floor(loaded)));
    const previous = this._knownDownloadedFrames.get(displaySetInstanceUID);
    if (
      previous &&
      previous.loaded >= safeLoaded &&
      previous.total >= safeTotal
    ) {
      return;
    }
    this._knownDownloadedFrames.set(displaySetInstanceUID, {
      loaded: Math.max(previous?.loaded ?? 0, safeLoaded),
      total: Math.max(previous?.total ?? 0, safeTotal),
    });
  }

  /**
   * Returns current load progress for a display set (if tracked).
   * Used by the study panel to show instance download progress.
   * Study-wide frame totals use `_knownDownloadedFrames` separately so a page
   * change does not drop the header count (see getStudyDownloadProgress).
   */
  public getDisplaySetLoadProgress(
    displaySetInstanceUID: string
  ): DisplaySetDownloadProgress | undefined {
    const viewportProgress = this._viewportDownloadProgress.get(displaySetInstanceUID);

    // On-screen US clips report "downloaded at least once". That wins over the
    // decode-cache bookkeeping: eviction must not make the study-panel bar jump
    // backward and blink after a clip already finished downloading.
    if (viewportProgress) {
      const { loaded, total, failed } = viewportProgress;
      this._recordKnownDownloadedFrames(displaySetInstanceUID, loaded, total);
      return {
        loadingProgress: Math.min(1, loaded / total),
        numInstances: total,
        showStudyPanelProgress: loaded < total,
        failed,
      };
    }

    const completedInstances = this._completedDisplaySets.get(displaySetInstanceUID);

    if (completedInstances != null) {
      this._recordKnownDownloadedFrames(
        displaySetInstanceUID,
        completedInstances,
        completedInstances
      );
      return {
        loadingProgress: 1,
        numInstances: completedInstances,
        showStudyPanelProgress: false,
        failed: 0,
      };
    }

    const state = this._displaySetLoadingStates.get(displaySetInstanceUID);
    if (!state) {
      // Off-screen after a page change: still report durable progress so thumbnails
      // / study math can see what was already downloaded on a previous layout.
      const known = this._knownDownloadedFrames.get(displaySetInstanceUID);
      if (!known) {
        return undefined;
      }
      return {
        loadingProgress: Math.min(1, known.loaded / known.total),
        numInstances: known.total,
        showStudyPanelProgress: known.loaded < known.total,
        failed: 0,
      };
    }
    this._recordKnownDownloadedFrames(
      displaySetInstanceUID,
      Math.round(Math.min(1, state.loadingProgress) * Math.max(1, state.numInstances)),
      state.numInstances
    );
    return {
      loadingProgress: state.loadingProgress,
      numInstances: state.numInstances,
      showStudyPanelProgress: this._studyPanelProgressDisplaySetUIDs.has(displaySetInstanceUID),
      failed: state.failedImageIds.size,
    };
  }

  /**
   * Download progress of the display set a viewport is showing, reported by the
   * viewport (e.g. US clip frames). Shown on the study panel instead of the
   * viewport. Pass `null` once no viewport shows it any more.
   * When a clip finishes its first-pass download, mark the display set complete
   * so study-level counts and prefetch of the rest of the study can move on.
   */
  public reportViewportDownloadProgress(
    displaySetInstanceUID: string,
    progress: { loaded: number; total: number; failed?: number } | null
  ): void {
    if (!displaySetInstanceUID) {
      return;
    }

    if (!progress || !(progress.total > 0)) {
      if (this._viewportDownloadProgress.delete(displaySetInstanceUID)) {
        this._triggerDisplaySetEvents(displaySetInstanceUID);
      }
      return;
    }

    const next: ViewportDownloadProgress = {
      loaded: Math.max(0, Math.min(progress.total, progress.loaded)),
      total: progress.total,
      failed: Math.max(0, progress.failed ?? 0),
    };
    const previous = this._viewportDownloadProgress.get(displaySetInstanceUID);
    const justCompleted =
      next.loaded >= next.total && (!previous || previous.loaded < previous.total);

    if (
      previous &&
      previous.loaded === next.loaded &&
      previous.total === next.total &&
      previous.failed === next.failed
    ) {
      return;
    }

    this._viewportDownloadProgress.set(displaySetInstanceUID, next);
    this._recordKnownDownloadedFrames(displaySetInstanceUID, next.loaded, next.total);

    if (justCompleted && !this._completedDisplaySets.has(displaySetInstanceUID)) {
      this._markDisplaySetCompleted(displaySetInstanceUID, next.total);
    }

    this._triggerDisplaySetEvents(displaySetInstanceUID);

    // Current layout finished: let a paused study download continue for the rest.
    if (justCompleted) {
      this._sendNextRequests();
    }
  }

  /** How much of a study's image display sets is already downloaded. */
  public getStudyDownloadProgress(StudyInstanceUID: string): StudyDownloadProgress {
    const displaySets = this._getStudyImageDisplaySets(StudyInstanceUID);
    const pending = new Set(this._userRequestedDisplaySetUIDs);
    const studyRequested = this._requestedStudyUIDs.has(StudyInstanceUID);
    let downloaded = 0;
    let isPrefetching = false;
    let loadedFrames = 0;
    let totalFrames = 0;

    displaySets.forEach(displaySet => {
      const uid = displaySet.displaySetInstanceUID;
      const progress = this.getDisplaySetLoadProgress(uid);
      const known = this._knownDownloadedFrames.get(uid);
      const frames = Math.max(
        0,
        Number(known?.total) ||
          Number(progress?.numInstances) ||
          Number((displaySet as unknown as { numImageFrames?: number }).numImageFrames) ||
          0
      );

      totalFrames += frames;

      // Prefer the durable high-water mark so paging the layout cannot drop the
      // study header (e.g. 616 → 98 when leaving page 1 for page 2).
      const knownLoaded = known?.loaded ?? 0;
      const liveLoaded = progress
        ? Math.round(Math.min(1, progress.loadingProgress) * frames)
        : 0;
      const done = Math.max(
        knownLoaded,
        this._completedDisplaySets.has(uid) ? frames : 0,
        Math.max(0, liveLoaded - (progress?.failed ?? 0))
      );
      loadedFrames += Math.min(frames, done);

      if (this._completedDisplaySets.has(uid) || (frames > 0 && done >= frames)) {
        downloaded += 1;
      }

      // Display sets on a viewport download there (not via the prefetch queue).
      const viewportProgress = this._viewportDownloadProgress.get(uid);
      const viewportDownloading = Boolean(
        viewportProgress && viewportProgress.loaded < viewportProgress.total
      );

      if (pending.has(uid) || viewportDownloading) {
        isPrefetching = true;
      }
    });

    if (studyRequested && pending.size > 0) {
      isPrefetching = true;
    }

    if (!isPrefetching && downloaded >= displaySets.length) {
      this._requestedStudyUIDs.delete(StudyInstanceUID);
    }

    return {
      downloaded,
      total: displaySets.length,
      isPrefetching,
      loadedFrames: Math.min(loadedFrames, totalFrames),
      totalFrames,
    };
  }

  /**
   * Cornerstone streaming volume frame progress (`IMAGE_VOLUME_MODIFIED`).
   * Wired from the cornerstone extension init (not used for pure stack viewports).
   */
  public notifyVolumeStreamProgress(
    volumeId: string,
    framesProcessed: number,
    numberOfFrames: number
  ): void {
    if (!this._isRunning) {
      return;
    }
    const displaySetInstanceUID = this._parseDisplaySetInstanceUIDFromVolumeId(volumeId);
    if (!displaySetInstanceUID) {
      return;
    }
    if (!this._shouldApplyCornerstoneVolumeProgress(displaySetInstanceUID)) {
      return;
    }
    const state = this._displaySetLoadingStates.get(displaySetInstanceUID);
    if (!state || state.loadingProgress >= 1) {
      return;
    }
    const safeTotal = Math.max(1, Number(numberOfFrames) || 1);
    const safeProcessed = Math.min(
      safeTotal,
      Math.max(0, Math.floor(Number(framesProcessed) || 0))
    );
    state.volumeStreamProgress = {
      framesProcessed: safeProcessed,
      numberOfFrames: safeTotal,
    };
    state.numInstances = Math.max(state.numInstances, safeTotal);
    this._updateDisplaySetLoadingProgress(state);
    this._triggerDisplaySetEvents(displaySetInstanceUID);
  }

  /**
   * Cornerstone fires this when a streaming volume has finished loading all frames.
   */
  public notifyVolumeFullyLoaded(volumeId: string): void {
    const displaySetInstanceUID = this._parseDisplaySetInstanceUIDFromVolumeId(volumeId);
    if (!displaySetInstanceUID) {
      return;
    }
    const state = this._displaySetLoadingStates.get(displaySetInstanceUID);
    if (!state) {
      return;
    }
    delete state.volumeStreamProgress;
    this._markDisplaySetAllImagesLoaded(displaySetInstanceUID);
  }

  private _parseDisplaySetInstanceUIDFromVolumeId(volumeId: string): string | undefined {
    if (typeof volumeId !== 'string' || !volumeId.length) {
      return undefined;
    }
    const i = volumeId.indexOf(':');
    if (i < 0 || i >= volumeId.length - 1) {
      return undefined;
    }
    return volumeId.slice(i + 1);
  }

  private _shouldApplyCornerstoneVolumeProgress(displaySetInstanceUID: string): boolean {
    if (!this._displaySetLoadingStates.has(displaySetInstanceUID)) {
      return false;
    }
    if (this._activeDisplaySetsInstanceUIDs.includes(displaySetInstanceUID)) {
      return true;
    }
    if (this._studyPanelProgressDisplaySetUIDs.has(displaySetInstanceUID)) {
      return true;
    }
    return false;
  }

  /**
   * Align internal sets with a fully loaded volume (per-slice cache may still be empty).
   */
  private _markDisplaySetAllImagesLoaded(displaySetInstanceUID: string): void {
    const state = this._displaySetLoadingStates.get(displaySetInstanceUID);
    if (!state) {
      return;
    }
    const { displaySetService } = this._servicesManager.services;
    const displaySet = displaySetService.getDisplaySetByUID(displaySetInstanceUID);
    if (!displaySet) {
      return;
    }
    const imageIds = this._getImageIdsForDisplaySet(displaySet);
    if (!imageIds.length) {
      return;
    }
    for (const imageId of imageIds) {
      state.pendingImageIds.delete(imageId);
      state.loadedImageIds.add(imageId);
      this._updateImageIdsDisplaySetMap(displaySetInstanceUID, [imageId]);
    }
    state.numInstances = imageIds.length;
    this._updateDisplaySetLoadingProgress(state);
    this._triggerDisplaySetEvents(displaySetInstanceUID);
  }

  /**
   * Manually trigger background preload of a specific display set's instances.
   * Used when the user clicks the preload button on a series in the Study Panel.
   * Only a full load of all instances counts as "downloaded"; the first instance
   * loaded for the thumbnail does not.
   */
  public async prefetchDisplaySet(displaySetInstanceUID: string): Promise<void> {
    await this.prefetchDisplaySets([displaySetInstanceUID]);
  }

  /**
   * Download every image display set of a study in the background, in study
   * panel order. Display sets the current layout is still downloading are
   * skipped (viewport / clip buffer owns them). Once those finish, this queue
   * continues and the study frame count keeps growing. Layout changes restart
   * the automatic look-ahead so the new page is served first; user study
   * requests are re-queued after and resume remaining series.
   */
  public async prefetchStudy(StudyInstanceUID: string): Promise<void> {
    if (!this.config.enabled || !StudyInstanceUID) {
      return;
    }

    this._requestedStudyUIDs.add(StudyInstanceUID);

    const onViewport = this._getOnViewportDisplaySetUIDs();
    const uids = this._getStudyImageDisplaySets(StudyInstanceUID)
      .map(displaySet => displaySet.displaySetInstanceUID)
      .filter(uid => {
        if (this._completedDisplaySets.has(uid)) {
          return false;
        }
        // Still downloading on a visible tile — clip buffer owns it.
        const viewportProgress = this._viewportDownloadProgress.get(uid);
        if (
          onViewport.has(uid) &&
          viewportProgress &&
          viewportProgress.loaded < viewportProgress.total
        ) {
          return false;
        }
        // Fully reported by the viewport already.
        if (
          viewportProgress &&
          viewportProgress.total > 0 &&
          viewportProgress.loaded >= viewportProgress.total
        ) {
          return false;
        }
        return true;
      });

    await this.prefetchDisplaySets(uids);
  }

  /**
   * Queue user-requested display sets ahead of automatic prefetching, keeping
   * the given order. Failed instances are retried.
   */
  public async prefetchDisplaySets(displaySetInstanceUIDs: string[]): Promise<void> {
    if (!this.config.enabled || !displaySetInstanceUIDs?.length) {
      return;
    }

    const { displaySetService } = this._servicesManager.services;
    const displaySets = displaySetInstanceUIDs
      .filter(uid => !this._completedDisplaySets.has(uid))
      .map(uid => displaySetService.getDisplaySetByUID(uid))
      .filter(displaySet => displaySet && !displaySet.unsupported);

    if (!displaySets.length) {
      return;
    }

    await this._ensureSeriesMetadataLoaded(displaySets);

    const requestedUIDs = displaySets.map(displaySet => displaySet.displaySetInstanceUID);
    const requested = new Set(requestedUIDs);

    this._userRequestedDisplaySetUIDs = [
      ...requestedUIDs,
      ...this._userRequestedDisplaySetUIDs.filter(uid => !requested.has(uid)),
    ];
    requestedUIDs.forEach(uid => this._retryFailedImages(uid));

    if (!this._isRunning) {
      this._startPrefetching();
      return;
    }

    this._enqueueUserRequestedDisplaySets();
    this._sendNextRequests();
  }

  private _getStudyImageDisplaySets(StudyInstanceUID: string): DisplaySet[] {
    const { displaySetService } = this._servicesManager.services;

    return this._sortByStudyPanelOrder(
      displaySetService
        .getActiveDisplaySets()
        .filter(
          displaySet =>
            displaySet.StudyInstanceUID === StudyInstanceUID &&
            !displaySet.unsupported &&
            !(displaySet as unknown as { excludeFromThumbnailBrowser?: boolean })
              .excludeFromThumbnailBrowser &&
            !NO_IMAGE_MODALITIES.includes(displaySet.Modality)
        )
    );
  }

  /**
   * The order thumbnails appear in the study panel, so "next series" means the
   * next thumbnail. Display sets the panel does not list keep their order, last.
   */
  private _sortByStudyPanelOrder(displaySets: DisplaySet[]): DisplaySet[] {
    const panelOrder = getStudyPanelNavigationOrder();

    if (!panelOrder.length) {
      return [...displaySets];
    }

    const rank = new Map(panelOrder.map((uid, index) => [uid, index]));

    return displaySets
      .map((displaySet, index) => ({ displaySet, index }))
      .sort((a, b) => {
        const rankA = rank.get(a.displaySet.displaySetInstanceUID) ?? panelOrder.length + a.index;
        const rankB = rank.get(b.displaySet.displaySetInstanceUID) ?? panelOrder.length + b.index;
        return rankA - rankB;
      })
      .map(({ displaySet }) => displaySet);
  }

  private _getOnViewportDisplaySetUIDs(): Set<string> {
    const { viewportGridService } = this._servicesManager.services;
    const uids = new Set<string>();

    viewportGridService.getState()?.viewports?.forEach(viewport => {
      viewport?.displaySetInstanceUIDs?.forEach(uid => uid && uids.add(uid));
    });

    return uids;
  }

  /**
   * Frames the display set is known to have. With on-demand series metadata
   * the image id list can be partial, and finishing it is not "downloaded".
   */
  private _getExpectedInstanceCount(displaySetInstanceUID: string): number {
    const { displaySetService } = this._servicesManager.services;
    const displaySet = displaySetService.getDisplaySetByUID(displaySetInstanceUID) as unknown as
      | { numImageFrames?: number }
      | undefined;
    const expected = Number(displaySet?.numImageFrames);

    return Number.isFinite(expected) && expected > 0 ? expected : 0;
  }

  private _markDisplaySetCompleted(displaySetInstanceUID: string, numInstances: number): void {
    const instances = Math.max(1, numInstances || 1);
    this._completedDisplaySets.set(displaySetInstanceUID, instances);
    this._recordKnownDownloadedFrames(displaySetInstanceUID, instances, instances);
    const displaySet =
      this._servicesManager.services.displaySetService.getDisplaySetByUID(displaySetInstanceUID);
    if (displaySet) {
      this._getImageIdsForDisplaySet(displaySet).forEach(imageId =>
        this._completedImageIds.set(imageId, displaySetInstanceUID)
      );
    }
    // Keep viewport (clip) progress if present — it is the study-panel source of
    // truth for on-screen US and must not disappear when prefetch marks complete.
    this._studyPanelProgressDisplaySetUIDs.delete(displaySetInstanceUID);
    this._userRequestedDisplaySetUIDs = this._userRequestedDisplaySetUIDs.filter(
      uid => uid !== displaySetInstanceUID
    );
    this._pendingRequests = this._pendingRequests.filter(
      request => request.displaySetInstanceUID !== displaySetInstanceUID
    );
  }

  /**
   * With on-demand series metadata only part of the instances may be known;
   * fetch the rest (once per series) so every instance gets queued.
   */
  private async _ensureSeriesMetadataLoaded(displaySets: DisplaySet[]): Promise<void> {
    const dataSource = this._extensionManager.getActiveDataSource()[0];

    if (!dataSource?.retrieve?.series?.metadata) {
      return;
    }

    const seriesToFetch = new Map<string, DisplaySet>();

    displaySets.forEach(displaySet => {
      const expected = Number(
        (displaySet as unknown as { numImageFrames?: number }).numImageFrames
      );

      if (!Number.isFinite(expected) || expected <= 0) {
        return;
      }

      if (this._getImageIdsForDisplaySet(displaySet).length < expected) {
        seriesToFetch.set(displaySet.SeriesInstanceUID, displaySet);
      }
    });

    await Promise.all(
      Array.from(seriesToFetch.values()).map(displaySet =>
        Promise.resolve()
          .then(() =>
            dataSource.retrieve.series.metadata({
              StudyInstanceUID: displaySet.StudyInstanceUID,
              filters: { SeriesInstanceUID: displaySet.SeriesInstanceUID },
            })
          )
          .catch(e => console.warn('Failed to retrieve series metadata for preload', e))
      )
    );
  }

  private _retryFailedImages(displaySetInstanceUID: string): void {
    const state = this._displaySetLoadingStates.get(displaySetInstanceUID);

    if (!state?.failedImageIds.size) {
      return;
    }

    state.failedImageIds.forEach(imageId => state.pendingImageIds.add(imageId));
    state.failedImageIds.clear();
    this._updateDisplaySetLoadingProgress(state);
  }

  /** Put every outstanding user request at the front of the queue (most recent first). */
  private _enqueueUserRequestedDisplaySets(): void {
    const { displaySetService } = this._servicesManager.services;
    const displaySets: DisplaySet[] = [];

    this._userRequestedDisplaySetUIDs = this._userRequestedDisplaySetUIDs.filter(uid => {
      const displaySet = displaySetService.getDisplaySetByUID(uid);

      if (!displaySet || this._completedDisplaySets.has(uid)) {
        return false;
      }

      displaySets.push(displaySet);
      return true;
    });

    if (!displaySets.length) {
      return;
    }

    const uids = new Set(displaySets.map(displaySet => displaySet.displaySetInstanceUID));
    this._pendingRequests = this._pendingRequests.filter(
      request => !uids.has(request.displaySetInstanceUID)
    );

    // First frames of every display set before the rest of any of them, so each
    // one can be shown and start its cine before the budget runs out.
    const heads: ImageRequest[] = [];
    const tails: ImageRequest[] = [];
    const headSize = this._getHeadSize();

    displaySets.forEach(displaySet => {
      const uid = displaySet.displaySetInstanceUID;

      this._studyPanelProgressDisplaySetUIDs.add(uid);
      this._addDisplaySetLoadingState(displaySet);
      const requests = this._buildDisplaySetImageRequests(displaySet);
      heads.push(...requests.slice(0, headSize));
      tails.push(...requests.slice(headSize));

      if (this._displaySetLoadingStates.has(uid)) {
        this._triggerDisplaySetEvents(uid);
      }
    });

    this._pendingRequests.unshift(...heads, ...tails);
  }

  /** Frames per display set loaded first; Infinity when uncapped. */
  private _getHeadSize(): number {
    const cap = Number(this.config.maxImagesPerDisplaySetToPrefetch);
    return Number.isFinite(cap) && cap > 0 ? Math.floor(cap) : Infinity;
  }

  private _getPrefetchBudgetBytes(): number {
    const maxCacheSize = Number(this.cache?.getMaxCacheSizeInBytes?.());
    const fraction = Number(this.config.maxCacheFraction);

    if (!(maxCacheSize > 0) || !(fraction > 0)) {
      return Infinity;
    }

    return Math.floor(maxCacheSize * Math.min(1, fraction));
  }

  private _isPrefetchBudgetExhausted(): boolean {
    return this._prefetchResidentTotal >= this._getPrefetchBudgetBytes();
  }

  /**
   * The prefetch share of the cache is full: loading more would only evict
   * frames prefetched earlier. Drop the queue and settle user requests so the
   * study panel stops showing them as downloading (partly loaded ones keep
   * their progress and the download button).
   */
  private _haltForMemory(): void {
    this._stats.haltedForMemory += 1;
    this._pendingRequests = [];

    const uids = new Set([
      ...this._userRequestedDisplaySetUIDs,
      ...this._studyPanelProgressDisplaySetUIDs,
    ]);
    this._userRequestedDisplaySetUIDs = [];
    this._requestedStudyUIDs.clear();

    uids.forEach(uid => {
      if (this._completedDisplaySets.has(uid)) {
        return;
      }
      this._studyPanelProgressDisplaySetUIDs.delete(uid);
      this._broadcastEvent(this.EVENTS.DISPLAYSET_LOAD_COMPLETE, {
        displaySetInstanceUID: uid,
        showStudyPanelProgress: true,
      });
      this._triggerDisplaySetEvents(uid);
    });

    if (uids.size) {
      console.info(
        '[StudyPrefetcher] Prefetch stopped: prefetched frames reached the memory budget',
        Math.round(this._prefetchResidentTotal / (1024 * 1024)),
        'MB'
      );
    }
  }

  private _addImageLoadingEventsListeners() {
    const fnOnImageLoadCompleted = (imageId: string) => {
      // `sendNextRequests` must be called after image loaded/failed events
      // to make sure prefetch requests shall be sent as soon as the active
      // displaySets (active viewport) are loaded.
      //
      // PS: active display sets are not loaded by this service and that is why
      // the requests shall not be in the inflight queue.
      if (!this._inflightRequests.get(imageId)) {
        this._sendNextRequests();
      }
    };

    const fnImageLoadedEventListener = evt => {
      const { image } = evt.detail;
      const { imageId } = image;

      // Viewport / stack loads images outside the prefetch queue. If series metadata
      // grew after loading state was created, new imageIds were never registered in
      // `_imageIdsToDisplaySetsMap`, so `_moveImageIdToLoadedSet` would no-op. Merge
      // current image id lists for active + user-preload series when an unknown
      // image loads (a full merge on every load is quadratic over a study prefetch).
      if (!this._imageIdsToDisplaySetsMap.has(imageId)) {
        this._mergeCurrentImageIdsIntoLoadingStatesForActiveAndPreload();
      }
      this._moveImageIdToLoadedSet(imageId);
      fnOnImageLoadCompleted(imageId);
    };

    const fnImageLoadFailedEventListener = evt => {
      const { imageId } = evt.detail;

      if (!this._imageIdsToDisplaySetsMap.has(imageId)) {
        this._mergeCurrentImageIdsIntoLoadingStatesForActiveAndPreload();
      }
      this._moveImageIdToFailedSet(imageId);
      fnOnImageLoadCompleted(imageId);
    };

    return this.imageLoadEventsManager.addEventListeners(
      fnImageLoadedEventListener,
      fnImageLoadFailedEventListener
    );
  }

  private _addServicesListeners() {
    const { displaySetService, viewportGridService } = this._servicesManager.services;

    const displaySetMetadataInvalidatedSubscription = displaySetService.subscribe(
      displaySetService.EVENTS.DISPLAY_SET_SERIES_METADATA_INVALIDATED,
      ({ displaySetInstanceUID }: { displaySetInstanceUID: string }) => {
        if (displaySetInstanceUID) {
          this._mergeCurrentImageIdsIntoLoadingState(displaySetInstanceUID);
        }
      }
    );

    // Restart the prefetcher after any change to the displaySets
    // (eg: sorting the displaySets on StudyBrowser)
    const displaySetsChangedSubscription = displaySetService.subscribe(
      displaySetService.EVENTS.DISPLAY_SETS_CHANGED,
      () => this._syncWithActiveViewport({ forceRestart: true })
    );

    // Loads new datasets when making a new viewport active
    const viewportGridActiveViewportIdSubscription = viewportGridService.subscribe(
      ViewportGridService.EVENTS.ACTIVE_VIEWPORT_ID_CHANGED,
      ({ viewportId }) => this._syncWithActiveViewport({ activeViewportId: viewportId })
    );

    // Continue loading datasets after changing the layout (eg: from 1x1 to 2x1)
    const viewportGridLayoutChangedSubscription = viewportGridService.subscribe(
      ViewportGridService.EVENTS.LAYOUT_CHANGED,
      () => this._syncWithActiveViewport()
    );

    // Loads new datasets after loading a new display set on a viewport
    const viewportGridStateChangedSubscription = viewportGridService.subscribe(
      ViewportGridService.EVENTS.GRID_STATE_CHANGED,
      () => this._syncWithActiveViewport()
    );

    // Loads the first datasets right after opening the viewer
    const viewportGridViewportreadySubscription = viewportGridService.subscribe(
      ViewportGridService.EVENTS.VIEWPORTS_READY,
      () => {
        this._syncWithActiveViewport();
        this._startPrefetching();
      }
    );

    return [
      displaySetMetadataInvalidatedSubscription,
      displaySetsChangedSubscription,
      viewportGridActiveViewportIdSubscription,
      viewportGridLayoutChangedSubscription,
      viewportGridStateChangedSubscription,
      viewportGridViewportreadySubscription,
    ];
  }

  /** Display sets whose loading state should stay in sync with real image loads (viewport + preload). */
  private _getDisplaySetInstanceUIDsForImageListSync(): string[] {
    const uids = new Set<string>();
    this._activeDisplaySetsInstanceUIDs.forEach(uid => {
      if (uid) {
        uids.add(uid);
      }
    });
    this._studyPanelProgressDisplaySetUIDs.forEach(uid => uids.add(uid));
    return [...uids];
  }

  private _mergeCurrentImageIdsIntoLoadingStatesForActiveAndPreload(): void {
    for (const displaySetInstanceUID of this._getDisplaySetInstanceUIDsForImageListSync()) {
      this._mergeCurrentImageIdsIntoLoadingState(displaySetInstanceUID);
    }
  }

  /**
   * Reconcile loading state with the current `getImageIdsForDisplaySet` list so
   * instances loaded by the viewport (not only the prefetch queue) update progress.
   */
  private _mergeCurrentImageIdsIntoLoadingState(displaySetInstanceUID: string): void {
    const state = this._displaySetLoadingStates.get(displaySetInstanceUID);
    if (!state || state.loadingProgress >= 1) {
      return;
    }

    const { displaySetService } = this._servicesManager.services;
    const displaySet = displaySetService.getDisplaySetByUID(displaySetInstanceUID);
    if (!displaySet) {
      return;
    }

    const imageIds = this._getImageIdsForDisplaySet(displaySet);
    if (!imageIds.length) {
      return;
    }

    let changed = false;
    let addedNewImageIds = false;

    if (imageIds.length !== state.numInstances) {
      state.numInstances = imageIds.length;
      changed = true;
    }

    for (const imageId of imageIds) {
      if (
        state.loadedImageIds.has(imageId) ||
        state.failedImageIds.has(imageId) ||
        state.pendingImageIds.has(imageId)
      ) {
        continue;
      }
      addedNewImageIds = true;
      if (this.cache.isImageCached(imageId)) {
        state.loadedImageIds.add(imageId);
      } else {
        state.pendingImageIds.add(imageId);
      }
      this._updateImageIdsDisplaySetMap(displaySetInstanceUID, [imageId]);
      changed = true;
    }

    if (changed) {
      this._updateDisplaySetLoadingProgress(state);
      this._triggerDisplaySetEvents(displaySetInstanceUID);
    }

    // User preload: if metadata expanded, re-queue so remaining instances still prefetch.
    if (
      addedNewImageIds &&
      this._isRunning &&
      this._studyPanelProgressDisplaySetUIDs.has(displaySetInstanceUID)
    ) {
      this._enqueueDisplaySetImagesRequests(displaySet, true);
      this._sendNextRequests();
    }
  }

  private _addEventListeners() {
    const imageLoadingEventsSubscriptions = this._addImageLoadingEventsListeners();
    const servicesSubscriptions = this._addServicesListeners();

    this._subscriptions.push(...imageLoadingEventsSubscriptions);
    this._subscriptions.push(...servicesSubscriptions);
  }

  private _removeEventListeners() {
    this._subscriptions.forEach(subscription => subscription.unsubscribe());
    this._subscriptions = [];
  }

  private _syncWithActiveViewport({
    activeViewportId,
    forceRestart,
  }: {
    activeViewportId?: string;
    forceRestart?: boolean;
  } = {}) {
    const { viewportGridService } = this._servicesManager.services;
    const viewportGridServiceState = viewportGridService.getState();
    const { viewports } = viewportGridServiceState;

    activeViewportId = activeViewportId ?? viewportGridServiceState.activeViewportId;

    // If may be null when the viewer is loaded
    if (!activeViewportId) {
      return;
    }

    const activeViewport = viewports.get(activeViewportId);

    if (!activeViewport) {
      return;
    }

    const displaySetUpdated = this._setActiveDisplaySetsUIDs(activeViewport.displaySetInstanceUIDs);

    if (forceRestart || displaySetUpdated) {
      this._restartPrefetching();
    }
  }

  private _setActiveDisplaySetsUIDs(newActiveDisplaySetInstanceUIDs: string[]): boolean {
    const sameDisplaySets =
      newActiveDisplaySetInstanceUIDs.length === this._activeDisplaySetsInstanceUIDs.length &&
      newActiveDisplaySetInstanceUIDs.every(uid =>
        this._activeDisplaySetsInstanceUIDs.includes(uid)
      );

    if (sameDisplaySets) {
      return false;
    }

    this._activeDisplaySetsInstanceUIDs = [...newActiveDisplaySetInstanceUIDs];
    this._restartPrefetching();

    return true;
  }

  private _areActiveDisplaySetsLoaded() {
    const { _activeDisplaySetsInstanceUIDs: displaySetsInstanceUIDs } = this;

    return (
      displaySetsInstanceUIDs.length > 0 &&
      displaySetsInstanceUIDs.every(displaySetsInstanceUID => {
        if (this._completedDisplaySets.has(displaySetsInstanceUID)) {
          return true;
        }
        const viewportProgress = this._viewportDownloadProgress.get(displaySetsInstanceUID);
        if (
          viewportProgress &&
          viewportProgress.total > 0 &&
          viewportProgress.loaded >= viewportProgress.total
        ) {
          return true;
        }
        const state = this._displaySetLoadingStates.get(displaySetsInstanceUID);
        return state != null && state.loadingProgress >= 1;
      })
    );
  }

  private _getClosestDisplaySets(displaySets: DisplaySet[], activeDisplaySetIndex: number) {
    const sortedDisplaySets = [];
    let previousIndex = activeDisplaySetIndex - 1;
    let nextIndex = activeDisplaySetIndex + 1;

    while (previousIndex >= 0 || nextIndex < displaySets.length) {
      if (previousIndex >= 0) {
        sortedDisplaySets.push(displaySets[previousIndex]);
        previousIndex--;
      }

      if (nextIndex < displaySets.length) {
        sortedDisplaySets.push(displaySets[nextIndex]);
        nextIndex++;
      }
    }

    return sortedDisplaySets;
  }

  private _getDownwardDisplaySets(displaySets: DisplaySet[], activeDisplaySetIndex: number) {
    const sortedDisplaySets = [];

    for (let i = activeDisplaySetIndex + 1; i < displaySets.length; i++) {
      sortedDisplaySets.push(displaySets[i]);
    }

    return sortedDisplaySets;
  }

  private _getUpwardDisplaySets(displaySets: DisplaySet[], activeDisplaySetIndex: number) {
    const sortedDisplaySets = [];

    for (let i = activeDisplaySetIndex - 1; i >= 0 && i !== activeDisplaySetIndex; i--) {
      sortedDisplaySets.push(displaySets[i]);
    }

    return sortedDisplaySets;
  }

  private _getSortedDisplaySetsToPrefetch(displaySets: DisplaySet[]): DisplaySet[] {
    if (!this._activeDisplaySetsInstanceUIDs?.length) {
      return [];
    }

    const displaySetsCount = this.config.prefetchAllSeries
      ? Infinity
      : Math.max(0, Number(this.config.displaySetsCount) || 0);
    const activeDisplaySetsInstanceUIDs = this._activeDisplaySetsInstanceUIDs;
    const [activeDisplaySetUID] = activeDisplaySetsInstanceUIDs;
    const activeDisplaySetIndex = displaySets.findIndex(
      ds => ds.displaySetInstanceUID === activeDisplaySetUID
    );
    const getDisplaySetsFunctionsMap = {
      [StudyPrefetchOrder.closest]: this._getClosestDisplaySets,
      [StudyPrefetchOrder.downward]: this._getDownwardDisplaySets,
      [StudyPrefetchOrder.upward]: this._getUpwardDisplaySets,
    };
    const { order } = this.config;
    const fnGetDisplaySets = getDisplaySetsFunctionsMap[order];

    if (!fnGetDisplaySets) {
      throw new Error(`Invalid order (${order})`);
    }

    // Skip what is active, on any viewport (the viewport downloads it) or
    // already downloaded, so the prefetcher moves on to the next series.
    const skip = new Set([
      ...activeDisplaySetsInstanceUIDs,
      ...this._getOnViewportDisplaySetUIDs(),
    ]);

    return fnGetDisplaySets
      .call(this, displaySets, activeDisplaySetIndex)
      .filter(
        ds =>
          !skip.has(ds.displaySetInstanceUID) &&
          !this._completedDisplaySets.has(ds.displaySetInstanceUID) &&
          !ds.unsupported &&
          !NO_IMAGE_MODALITIES.includes(ds.Modality) &&
          !this._isDisplaySetHeadResident(ds)
      )
      .slice(0, displaySetsCount);
  }

  private _getDisplaySets() {
    const { displaySetService } = this._servicesManager.services;
    const displaySets = this._sortByStudyPanelOrder(displaySetService.getActiveDisplaySets());
    const displaySetsToPrefetch = this._getSortedDisplaySetsToPrefetch(displaySets);

    return { displaySets, displaySetsToPrefetch };
  }

  private _updateImageIdsDisplaySetMap(displaySetInstanceUID: string, imageIds: string[]): void {
    for (const imageId of imageIds) {
      let displaySetsInstanceUIDsMap = this._imageIdsToDisplaySetsMap.get(imageId);

      if (!displaySetsInstanceUIDsMap) {
        displaySetsInstanceUIDsMap = new Set();
        this._imageIdsToDisplaySetsMap.set(imageId, displaySetsInstanceUIDsMap);
      }

      displaySetsInstanceUIDsMap.add(displaySetInstanceUID);
    }
  }

  private _getImageIdsForDisplaySet(displaySet: DisplaySet): string[] {
    // Prefer displaySet-provided imageIds (set by cornerstone viewport/cache services)
    // so progress tracking uses the exact IDs that are actually loaded in viewports.
    if (Array.isArray(displaySet.imageIds) && displaySet.imageIds.length > 0) {
      return displaySet.imageIds;
    }

    let imageIds: string[] = [];

    try {
      const dataSource = this._extensionManager.getActiveDataSource()[0];
      imageIds = dataSource?.getImageIdsForDisplaySet(displaySet) ?? [];
    } catch {
      // Non-image display sets (SR, …) have no image ids.
      return [];
    }

    // Keep displaySet.imageIds in sync when only the datasource knew them.
    if (Array.isArray(imageIds) && imageIds.length > 0) {
      displaySet.imageIds = imageIds;
    }

    return Array.isArray(imageIds) ? imageIds : [];
  }

  private _updateDisplaySetLoadingProgress(displaySetLoadingState: DisplaySetLoadingState) {
    const {
      displaySetInstanceUID,
      volumeStreamProgress,
      numInstances,
      loadedImageIds,
      failedImageIds,
    } = displaySetLoadingState;
    if (volumeStreamProgress) {
      const { framesProcessed, numberOfFrames } = volumeStreamProgress;
      const total = Math.max(1, numberOfFrames, numInstances);
      displaySetLoadingState.loadingProgress = Math.min(1, framesProcessed / total);
      displaySetLoadingState.numInstances = Math.max(displaySetLoadingState.numInstances, total);
      this._recordKnownDownloadedFrames(displaySetInstanceUID, framesProcessed, total);
      return;
    }
    const denom = Math.max(1, numInstances);
    const done = loadedImageIds.size + failedImageIds.size;
    displaySetLoadingState.loadingProgress = done / denom;
    this._recordKnownDownloadedFrames(displaySetInstanceUID, done, denom);
  }

  private _addDisplaySetLoadingState(displaySet: DisplaySet): void {
    const { displaySetInstanceUID } = displaySet;

    if (this._completedDisplaySets.has(displaySetInstanceUID)) {
      return;
    }

    const imageIds = this._getImageIdsForDisplaySet(displaySet);
    let displaySetLoadingState = this._displaySetLoadingStates.get(displaySetInstanceUID);

    if (displaySetLoadingState) {
      // Metadata can expand after initial load (e.g. loadSeriesMetadataOnDemand).
      // Keep tracked instance count and pending set in sync with newly discovered imageIds.
      if (imageIds.length > displaySetLoadingState.numInstances) {
        displaySetLoadingState.numInstances = imageIds.length;

        for (const imageId of imageIds) {
          const alreadyKnown =
            displaySetLoadingState.loadedImageIds.has(imageId) ||
            displaySetLoadingState.failedImageIds.has(imageId) ||
            displaySetLoadingState.pendingImageIds.has(imageId);
          if (alreadyKnown) {
            continue;
          }
          if (this.cache.isImageCached(imageId)) {
            displaySetLoadingState.loadedImageIds.add(imageId);
          } else {
            displaySetLoadingState.pendingImageIds.add(imageId);
          }
        }

        this._updateImageIdsDisplaySetMap(displaySetInstanceUID, imageIds);
        this._updateDisplaySetLoadingProgress(displaySetLoadingState);
        this._triggerDisplaySetEvents(displaySetInstanceUID);
      }
      return;
    }

    const pendingImageIds = new Set<string>(imageIds);
    const loadedImageIds = new Set<string>();

    // Needs to check which image is already loaded to update the progress properly
    // because some images may already be loaded (thumbnails and viewports).
    for (const imageId of imageIds) {
      if (this.cache.isImageCached(imageId)) {
        loadedImageIds.add(imageId);
      } else {
        pendingImageIds.add(imageId);
      }
    }

    displaySetLoadingState = {
      displaySetInstanceUID,
      numInstances: imageIds.length,
      pendingImageIds,
      loadedImageIds,
      failedImageIds: new Set(),
      loadingProgress: 0,
      volumeStreamProgress: undefined,
    };

    this._updateDisplaySetLoadingProgress(displaySetLoadingState);
    this._displaySetLoadingStates.set(displaySetInstanceUID, displaySetLoadingState);
    this._updateImageIdsDisplaySetMap(displaySetInstanceUID, imageIds);

    // Notify the UI that this display set is entering loading state (e.g: update StudyBrowser)
    // even if no images are loaded yet, so the UI can show a 0% progress bar.
    this._triggerDisplaySetEvents(displaySetInstanceUID);
  }

  private _loadDisplaySets() {
    const { displaySets, displaySetsToPrefetch } = this._getDisplaySets();
    const headSize = this._getHeadSize();

    displaySets.forEach(displaySet => this._addDisplaySetLoadingState(displaySet));
    // Look-ahead loads the opening frames of the next display sets only.
    displaySetsToPrefetch.forEach(displaySet =>
      this._enqueueDisplaySetImagesRequests(displaySet, false, headSize)
    );
  }

  /** The first `maxImagesPerDisplaySetToPrefetch` frames are decoded in cache. */
  private _isDisplaySetHeadResident(displaySet: DisplaySet): boolean {
    const headSize = this._getHeadSize();
    if (!Number.isFinite(headSize)) {
      return false;
    }
    const head = this._getImageIdsForDisplaySet(displaySet).slice(0, headSize);
    return head.length > 0 && head.every(imageId => this.cache.isImageCached(imageId));
  }

  private _moveImageIdToLoadedSet(imageId: string): boolean {
    const displaySetsInstanceUIDs = this._imageIdsToDisplaySetsMap.get(imageId);

    if (!displaySetsInstanceUIDs) {
      return;
    }

    for (const displaySetInstanceUID of Array.from(displaySetsInstanceUIDs.values())) {
      const displaySetLoadingState = this._displaySetLoadingStates.get(displaySetInstanceUID);
      if (!displaySetLoadingState) {
        continue;
      }
      const { pendingImageIds, loadedImageIds, failedImageIds } = displaySetLoadingState;

      pendingImageIds.delete(imageId);
      failedImageIds.delete(imageId);
      loadedImageIds.add(imageId);

      this._updateDisplaySetLoadingProgress(displaySetLoadingState);
      this._triggerDisplaySetEvents(displaySetInstanceUID);
    }

    return true;
  }

  private _moveImageIdToFailedSet(imageId: string): boolean {
    const displaySetsInstanceUIDs = this._imageIdsToDisplaySetsMap.get(imageId);

    if (!displaySetsInstanceUIDs) {
      return;
    }

    for (const displaySetInstanceUID of Array.from(displaySetsInstanceUIDs.values())) {
      const displaySetLoadingState = this._displaySetLoadingStates.get(displaySetInstanceUID);
      if (!displaySetLoadingState) {
        continue;
      }
      const { pendingImageIds, loadedImageIds, failedImageIds } = displaySetLoadingState;

      pendingImageIds.delete(imageId);
      if (loadedImageIds.has(imageId)) {
        continue;
      }
      failedImageIds.add(imageId);

      this._updateDisplaySetLoadingProgress(displaySetLoadingState);
      this._triggerDisplaySetEvents(displaySetInstanceUID);
    }

    return true;
  }

  private _triggerDisplaySetEvents(displaySetInstanceUID: string) {
    let progress = this.getDisplaySetLoadProgress(displaySetInstanceUID);
    let justCompleted = false;

    if (
      progress &&
      !this._completedDisplaySets.has(displaySetInstanceUID) &&
      progress.loadingProgress >= 1 &&
      !(progress.failed > 0) &&
      progress.numInstances >= this._getExpectedInstanceCount(displaySetInstanceUID)
    ) {
      this._markDisplaySetCompleted(displaySetInstanceUID, progress.numInstances);
      progress = this.getDisplaySetLoadProgress(displaySetInstanceUID);
      justCompleted = true;
    }

    if (!progress) {
      // No longer tracked (e.g. left the viewport before any prefetch state existed).
      this._broadcastEvent(this.EVENTS.DISPLAYSET_LOAD_PROGRESS, {
        displaySetInstanceUID,
        numInstances: undefined,
        loadingProgress: undefined,
        showStudyPanelProgress: false,
        failed: 0,
      });
      return;
    }

    const { loadingProgress, numInstances, showStudyPanelProgress, failed } = progress;

    this._broadcastEvent(this.EVENTS.DISPLAYSET_LOAD_PROGRESS, {
      displaySetInstanceUID,
      numInstances,
      loadingProgress,
      showStudyPanelProgress,
      failed,
    });

    if (justCompleted) {
      this._broadcastEvent(this.EVENTS.DISPLAYSET_LOAD_COMPLETE, {
        displaySetInstanceUID,
        showStudyPanelProgress: true,
      });
      return;
    }

    // Finished with failures: stop tracking it as in progress so the study
    // panel offers the download (retry) button again.
    if (loadingProgress >= 1 && !this._completedDisplaySets.has(displaySetInstanceUID)) {
      const wasTracked = this._studyPanelProgressDisplaySetUIDs.delete(displaySetInstanceUID);
      this._userRequestedDisplaySetUIDs = this._userRequestedDisplaySetUIDs.filter(
        uid => uid !== displaySetInstanceUID
      );
      this._broadcastEvent(this.EVENTS.DISPLAYSET_LOAD_COMPLETE, {
        displaySetInstanceUID,
        showStudyPanelProgress: wasTracked || showStudyPanelProgress,
      });
    }
  }

  /** A request of a stopped run settled: its network slot is free again. */
  private _settleOrphanedRequest(): void {
    this._orphanedInflight = Math.max(0, this._orphanedInflight - 1);
    this._sendNextRequests();
  }

  private _recordPrefetchResident(imageId: string): void {
    if (this._prefetchResidentBytes.has(imageId) || !this.cache.isImageCached(imageId)) {
      return;
    }
    const bytes = Math.max(0, Number(this.cache.getImageSizeInBytes?.(imageId)) || 0);
    this._prefetchResidentBytes.set(imageId, bytes);
    this._prefetchResidentTotal += bytes;
  }

  private _onImagePrefetchSuccess(imageRequest: ImageRequest) {
    const { imageId } = imageRequest;

    this._stats.loaded += 1;
    this._recordPrefetchResident(imageId);

    if (imageRequest.aborted) {
      this._settleOrphanedRequest();
      return;
    }

    this._inflightRequests.delete(imageId);
    this._moveImageIdToLoadedSet(imageId);

    // `sendNextRequests` must be called after removing the request from the inflight
    // queue otherwise it shall not be able to send the request (maxNumPrefetchRequests)
    this._sendNextRequests();
  }

  private _onImagePrefetchFailed(imageRequest: ImageRequest, error) {
    this._stats.failed += 1;

    if (imageRequest.aborted) {
      this._settleOrphanedRequest();
      return;
    }

    console.warn(`An error ocurred when trying to load "${imageRequest.imageId}"`, error);

    const { imageId } = imageRequest;

    this._inflightRequests.delete(imageId);
    this._moveImageIdToFailedSet(imageId);

    // `sendNextRequests` must be called after removing the request from the inflight
    // queue otherwise it shall not be able to send the request (maxNumPrefetchRequests)
    this._sendNextRequests();
  }

  /** Max concurrent prefetch requests when the active viewport is still loading (e.g. user-triggered preload). */
  private static readonly MAX_PREFETCH_WHEN_ACTIVE_LOADING = 2;
  /** While cine plays, leave connections free for Interaction / clip paint. */
  private static readonly MAX_PREFETCH_WHILE_PLAYING = 1;

  private async _sendNextRequests() {
    // If the service has stopped with async requests in progress this method may
    // get called again when each of those requests are fulfilled.
    if (!this._isRunning || this._pauseReasons.size) {
      return;
    }

    const { _pendingRequests: pendingRequests, _inflightRequests: inflightRequests } = this;
    const { maxNumPrefetchRequests } = this.config;

    if (!pendingRequests.length) {
      return;
    }

    if (this._isPrefetchBudgetExhausted()) {
      this._haltForMemory();
      return;
    }

    const activeLoaded = this._areActiveDisplaySetsLoaded();
    let maxConcurrent = activeLoaded
      ? maxNumPrefetchRequests
      : StudyPrefetcherService.MAX_PREFETCH_WHEN_ACTIVE_LOADING;
    if (this._smoothPlaybackMode) {
      maxConcurrent = Math.min(
        maxConcurrent,
        StudyPrefetcherService.MAX_PREFETCH_WHILE_PLAYING
      );
    }
    // Requests of a previous run still use connections until they settle.
    const busy = inflightRequests.size + this._orphanedInflight;

    if (busy >= maxConcurrent) {
      return;
    }

    const imageRequests: ImageRequest[] = [];

    while (pendingRequests.length && busy + imageRequests.length < maxConcurrent) {
      const imageRequest = pendingRequests.shift();
      const { imageId } = imageRequest;

      // Decoded meanwhile (viewport, thumbnail) or already loading elsewhere:
      // the IMAGE_LOADED event updates its progress, no second request needed.
      if (this.cache.isImageCached(imageId)) {
        this._moveImageIdToLoadedSet(imageId);
        continue;
      }
      if (inflightRequests.has(imageId) || this.cache.isImageLoading?.(imageId)) {
        continue;
      }

      imageRequests.push(imageRequest);
    }

    imageRequests.forEach(imageRequest => {
      const { imageId } = imageRequest;
      const options = {
        priority: -5,
        requestType: this.requestType,
        additionalDetails: { imageId },
        preScale: {
          enabled: true,
        },
      };

      this.imageLoadPoolManager.addRequest(
        async () => {
          imageRequest.started = true;
          return this.imageLoader.loadAndCacheImage(imageId, options).then(
            _image => this._onImagePrefetchSuccess(imageRequest),
            error => this._onImagePrefetchFailed(imageRequest, error)
          );
        },
        this.requestType,
        { imageId }
      );

      this._stats.sent += 1;
      inflightRequests.set(imageId, imageRequest);
    });
  }

  /**
   * Requests for the instances not decoded in cache (the first `limit` frames
   * only, when given); cached ones are marked loaded. Frames already loading
   * elsewhere stay pending and are completed by their IMAGE_LOADED event.
   */
  private _buildDisplaySetImageRequests(displaySet: DisplaySet, limit = Infinity): ImageRequest[] {
    const { displaySetInstanceUID } = displaySet;
    const requests: ImageRequest[] = [];

    this._getImageIdsForDisplaySet(displaySet)
      .slice(0, limit)
      .forEach(imageId => {
        if (this.cache.isImageCached(imageId)) {
          this._moveImageIdToLoadedSet(imageId);
          return;
        }

        if (this._inflightRequests.has(imageId) || this.cache.isImageLoading?.(imageId)) {
          return;
        }

        requests.push({
          displaySetInstanceUID,
          imageId,
          aborted: false,
        });
      });

    return requests;
  }

  private _enqueueDisplaySetImagesRequests(
    displaySet: DisplaySet,
    unshift: boolean = false,
    limit = Infinity
  ) {
    const { displaySetInstanceUID } = displaySet;

    // Remove existing requests for this display set so we can prioritize them at the front without duplicating
    if (unshift) {
      this._pendingRequests = this._pendingRequests.filter(
        req => req.displaySetInstanceUID !== displaySetInstanceUID
      );
    }

    const newRequests = this._buildDisplaySetImageRequests(displaySet, limit);

    if (unshift) {
      this._pendingRequests.unshift(...newRequests);
    } else {
      this._pendingRequests.push(...newRequests);
    }
  }

  /**
   * Start prefetching the display sets based on the active viewport and app configuration.
   */
  private _startPrefetching(): void {
    if (this._isRunning) {
      return;
    }

    if (!this.config.enabled) {
      console.log('StudyPrefetcher is not enabled');
      return;
    }

    this._isRunning = true;

    this._loadDisplaySets();
    this._enqueueUserRequestedDisplaySets();
    this._sendNextRequests();
    this._broadcastEvent(this.EVENTS.SERVICE_STARTED, {});
  }

  /**
   * Stop prefetching the display sets.
   * All internal variables are cleared but activeDisplaySetsInstanceUIDs and the
   * user-requested prefetches, otherwise a restart would drop them.
   */
  private _stopPrefetching(): void {
    if (!this._isRunning) {
      return;
    }
    this._isRunning = false;

    // Mark all inflight requests as aborted before clearing the map. Started ones
    // keep their connection until they settle, so they still count against
    // maxNumPrefetchRequests; queued ones are dropped with the request stack.
    this._inflightRequests.forEach(inflightRequest => {
      inflightRequest.aborted = true;
      if (inflightRequest.started) {
        this._orphanedInflight += 1;
      }
    });

    this._pendingRequests = [];
    this._displaySetLoadingStates.clear();
    this._studyPanelProgressDisplaySetUIDs.clear();
    this._imageIdsToDisplaySetsMap.clear();
    this._inflightRequests.clear();
    this.imageLoadPoolManager.clearRequestStack(this.requestType);

    this._broadcastEvent(this.EVENTS.SERVICE_STOPPED, {});
  }

  /**
   * Restart prefetching in case it is already running.
   */
  private _restartPrefetching(): void {
    if (this._isRunning) {
      this._stopPrefetching();
      this._startPrefetching();
    }
  }
}

export { StudyPrefetcherService as default, StudyPrefetcherService };
