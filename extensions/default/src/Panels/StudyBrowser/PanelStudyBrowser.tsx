import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useImageViewer } from '@ohif/ui-next';
import { useSystem, utils } from '@ohif/core';
import { useNavigate } from 'react-router-dom';
import { DicomMetadataStore } from '@ohif/core';
import { useViewportGrid, StudyBrowser, Separator, ProgressLoadingBar } from '@ohif/ui-next';
import { PanelStudyBrowserHeader } from './PanelStudyBrowserHeader';
import { defaultActionIcons } from './constants';
import MoreDropdownMenu from '../../Components/MoreDropdownMenu';
import { CallbackCustomization } from 'platform/core/src/types';
import { type TabsProps } from '@ohif/core/src/utils/createStudyBrowserTabs';
import { normalizeJpegImageId } from '../../DicomWebDataSource/utils/getImageId';
import { getViewerLayoutSync, mergeAndSaveViewerLayout } from '../../utils/viewerLayoutPreferences';

const { sortStudyInstances, formatDate, createStudyBrowserTabs } = utils;

const thumbnailNoImageModalities = ['SR', 'SEG', 'RTSTRUCT', 'RTPLAN', 'RTDOSE', 'DOC', 'PMAP'];

/** Persists study panel state across sidebar close/reopen so thumbnails and loading are not repeated. */
const studyPanelLoadSession = {
  fetchedStudyUIDs: new Set<string>(),
  viewportReadySessionKeys: new Set<string>(),
  studyDisplayLists: new Map<string, unknown[]>(),
  thumbnailImageSrcMap: {} as Record<string, string>,
};

function getStudySessionKey(studyInstanceUIDs: string[]) {
  return studyInstanceUIDs.length ? [...studyInstanceUIDs].sort().join('|') : '';
}

function isStructuredReportDisplaySet(displaySet) {
  if (!displaySet) {
    return false;
  }
  if (displaySet.Modality === 'SR') {
    return true;
  }
  const handlerId = displaySet.SOPClassHandlerId;
  return typeof handlerId === 'string' && handlerId.includes('dicom-sr');
}

/** Non-image viewports (e.g. SR text) never get cornerstone element / isReady. */
function viewportHasOnlyNonImageDisplaySets(viewport, displaySetService) {
  const uids = viewport?.displaySetInstanceUIDs || [];
  if (!uids.length) {
    return false;
  }
  const sets = uids
    .map(uid => displaySetService.getDisplaySetByUID(uid))
    .filter(ds => ds && !ds.unsupported);
  return (
    sets.length > 0 &&
    sets.every(
      ds =>
        thumbnailNoImageModalities.includes(ds.Modality) || isStructuredReportDisplaySet(ds)
    )
  );
}

/**
 * Study Browser component that displays and manages studies and their display sets
 */
function PanelStudyBrowser({
  getImageSrc,
  getStudiesForPatientByMRN,
  requestDisplaySetCreationForStudy,
  dataSource,
  customMapDisplaySets,
  onClickUntrack,
  onDoubleClickThumbnailHandlerCallBack,
}) {
  const { servicesManager, commandsManager, extensionManager } = useSystem();
  const { displaySetService, customizationService, studyPrefetcherService } = servicesManager.services;
  const navigate = useNavigate();
  const studyMode = (customizationService.getCustomization('studyBrowser.studyMode') as string) || 'all';

  const internalImageViewer = useImageViewer();
  const StudyInstanceUIDs = internalImageViewer.StudyInstanceUIDs;
  const sessionKey = useMemo(
    () => getStudySessionKey(StudyInstanceUIDs),
    [StudyInstanceUIDs.join(',')]
  );
  const fetchedStudiesRef = useRef(studyPanelLoadSession.fetchedStudyUIDs);
  const hasCachedViewportReady = sessionKey
    ? studyPanelLoadSession.viewportReadySessionKeys.has(sessionKey)
    : false;

  const [{ activeViewportId, viewports, isHangingProtocolLayout }] = useViewportGrid();
  const activeDisplaySetInstanceUIDs = useMemo(() => {
    const activeViewport = viewports.get(activeViewportId);
    const displaySetUIDs = activeViewport?.displaySetInstanceUIDs || [];
    const singleDisplaySetUID = activeViewport?.displaySetInstanceUID;

    if (!singleDisplaySetUID) {
      return displaySetUIDs;
    }

    return Array.from(new Set([...displaySetUIDs, singleDisplaySetUID]));
  }, [viewports, activeViewportId]);
  const [activeTabName, setActiveTabName] = useState(studyMode);
  const [expandedStudyInstanceUIDs, setExpandedStudyInstanceUIDs] = useState(
    studyMode === 'primary' && StudyInstanceUIDs.length > 0
      ? [StudyInstanceUIDs[0]]
      : [...StudyInstanceUIDs]
  );
  const [hasLoadedViewports, setHasLoadedViewports] = useState(hasCachedViewportReady);
  const [isStudyPanelLoading, setIsStudyPanelLoading] = useState(() => {
    if (!StudyInstanceUIDs.length) {
      return false;
    }
    if (hasCachedViewportReady) {
      return false;
    }
    return !StudyInstanceUIDs.every(uid => fetchedStudiesRef.current.has(uid));
  });
  const [studyDisplayList, setStudyDisplayList] = useState(
    () => studyPanelLoadSession.studyDisplayLists.get(sessionKey) ?? []
  );
  const [displaySets, setDisplaySets] = useState([]);
  const [displaySetsLoadingState, setDisplaySetsLoadingState] = useState({});
  const [thumbnailImageSrcMap, setThumbnailImageSrcMap] = useState(() => ({
    ...studyPanelLoadSession.thumbnailImageSrcMap,
  }));
  /** Display sets the user explicitly preloaded (download) — show progress on those thumbnails too */
  const [prefetchProgressTrackByUid, setPrefetchProgressTrackByUid] = useState({});
  const [jumpToDisplaySet, setJumpToDisplaySet] = useState(null);

  const [viewPresets, setViewPresets] = useState(() => {
    const custom = customizationService.getCustomization('studyBrowser.viewPresets');
    const savedPreset = getViewerLayoutSync()?.leftPanel?.studyBrowserViewPreset;
    if (!savedPreset || !Array.isArray(custom)) {
      return custom;
    }
    return custom.map(preset => ({
      ...preset,
      selected: preset.id === savedPreset,
    }));
  });

  const [actionIcons, setActionIcons] = useState(defaultActionIcons);

  // multiple can be true or false
  const updateActionIconValue = actionIcon => {
    actionIcon.value = !actionIcon.value;
    const newActionIcons = [...actionIcons];
    setActionIcons(newActionIcons);
  };

  // only one is true at a time
  const updateViewPresetValue = viewPreset => {
    if (!viewPreset) {
      return;
    }
    const newViewPresets = viewPresets.map(preset => {
      return {
        ...preset,
        selected: preset.id === viewPreset.id,
      };
    });
    setViewPresets(newViewPresets);
    if (viewPreset.id === 'list' || viewPreset.id === 'thumbnails') {
      mergeAndSaveViewerLayout({
        leftPanel: { studyBrowserViewPreset: viewPreset.id },
      });
    }
  };

  /**
   * StudyBrowserSort only mounts when the settings row is visible; with settings off (default),
   * active display sets never get sorted and stay in server/insertion order. Hanging protocols
   * still use series number, so the main viewport and the thumbnail strip disagree. Apply the
   * default study-browser sort (first customization entry, ascending) when settings are hidden.
   */
  const applyDefaultStudyBrowserSortIfNeeded = useCallback(() => {
    const showStudyBrowserSettings = actionIcons.find(icon => icon.id === 'settings')?.value;
    if (showStudyBrowserSettings) {
      return;
    }
    const sortFunctions = customizationService.getCustomization('studyBrowser.sortFunctions') as
      | { sortFunction: (a: unknown, b: unknown) => number }[]
      | undefined;
    const sortFn = sortFunctions?.[0]?.sortFunction;
    if (typeof sortFn !== 'function') {
      return;
    }
    displaySetService.sortDisplaySets(sortFn, 'ascending', true);
  }, [actionIcons, customizationService, displaySetService]);

  const mapDisplaySetsWithState = customMapDisplaySets || _mapDisplaySets;

  const finalizeMappedDisplaySetsForProgressVisibility = useCallback(
    mappedThumbnails => {
      return applyStudyBrowserSeriesProgressVisibility(
        mappedThumbnails,
        activeDisplaySetInstanceUIDs,
        prefetchProgressTrackByUid
      );
    },
    [activeDisplaySetInstanceUIDs, prefetchProgressTrackByUid]
  );

  const handlePrefetchDisplaySet = useCallback(
    displaySetInstanceUID => {
      if (!displaySetInstanceUID || !studyPrefetcherService?.prefetchDisplaySet) {
        return;
      }
      setPrefetchProgressTrackByUid(prev =>
        prev[displaySetInstanceUID] ? prev : { ...prev, [displaySetInstanceUID]: true }
      );
      studyPrefetcherService.prefetchDisplaySet(displaySetInstanceUID);
    },
    [studyPrefetcherService]
  );

  // Subscribe to instance load progress (prefetcher + viewport loads) for study panel progress bar
  useEffect(() => {
    if (!studyPrefetcherService?.subscribe) return;
    const subProgress = studyPrefetcherService.subscribe(
      studyPrefetcherService.EVENTS.DISPLAYSET_LOAD_PROGRESS,
      ({ displaySetInstanceUID, numInstances, loadingProgress, showStudyPanelProgress }) => {
        if (!showStudyPanelProgress) {
          return;
        }
        setDisplaySetsLoadingState(prev => ({
          ...prev,
          [displaySetInstanceUID]: { loadingProgress, numInstances, showStudyPanelProgress: true },
        }));
      }
    );
    const subComplete = studyPrefetcherService.subscribe(
      studyPrefetcherService.EVENTS.DISPLAYSET_LOAD_COMPLETE,
      ({ displaySetInstanceUID, showStudyPanelProgress }) => {
        if (!showStudyPanelProgress) {
          return;
        }
        setDisplaySetsLoadingState(prev => {
          const next = { ...prev };
          delete next[displaySetInstanceUID];
          return next;
        });
        setPrefetchProgressTrackByUid(prev => {
          if (!prev[displaySetInstanceUID]) {
            return prev;
          }
          const next = { ...prev };
          delete next[displaySetInstanceUID];
          return next;
        });
      }
    );
    return () => {
      subProgress?.unsubscribe?.();
      subComplete?.unsubscribe?.();
    };
  }, [studyPrefetcherService]);

  const onDoubleClickThumbnailHandler = useCallback(
    async displaySetInstanceUID => {
      let targetDisplaySet = displaySetService.getDisplaySetByUID(displaySetInstanceUID);
      if (targetDisplaySet?.Modality === 'SR') {
        const { StudyInstanceUID, SeriesInstanceUID } = targetDisplaySet;
        const series = DicomMetadataStore.getSeries(StudyInstanceUID, SeriesInstanceUID);
        if (!series?.instances?.length && dataSource?.retrieve?.series?.metadata) {
          try {
            await dataSource.retrieve.series.metadata({
              StudyInstanceUID,
              filters: { seriesInstanceUID: SeriesInstanceUID },
              madeInClient: true,
            });
            targetDisplaySet =
              displaySetService.getDisplaySetByUID(displaySetInstanceUID) ||
              displaySetService
                .getActiveDisplaySets()
                .find(
                  ds =>
                    ds.Modality === 'SR' && ds.SeriesInstanceUID === SeriesInstanceUID
                );
          } catch (error) {
            console.warn('Unable to load SR series metadata on double click', error);
          }
        }

        if (targetDisplaySet && typeof targetDisplaySet.load === 'function') {
          // Force a fresh SR load so ContentSequence is fetched via WADO-URI.
          targetDisplaySet.isLoaded = false;
          targetDisplaySet._loadPromise = null;
          try {
            await targetDisplaySet.load();
          } catch (error) {
            console.warn('Unable to load SR display set on double click', error);
          }
        }
      }

      const customHandler = customizationService.getCustomization(
        'studyBrowser.thumbnailDoubleClickCallback'
      ) as CallbackCustomization;

      const setupArgs = {
        activeViewportId,
        commandsManager,
        servicesManager,
        isHangingProtocolLayout,
        appConfig: extensionManager._appConfig,
      };

      const handlers = customHandler?.callbacks.map(callback => callback(setupArgs));

      for (const handler of handlers) {
        await handler(displaySetInstanceUID);
      }
      onDoubleClickThumbnailHandlerCallBack?.(displaySetInstanceUID);

      // Viewport may load JPEG fine while an earlier thumbnail attempt failed — refresh after display.
      const uid = displaySetInstanceUID;
      window.setTimeout(async () => {
        const ds = displaySetService.getDisplaySetByUID(uid);
        const thumbnailSrc = await loadThumbnailForDisplaySet({
          displaySet: ds,
          dataSource,
          getImageSrc,
        });
        if (thumbnailSrc) {
          setThumbnailImageSrcMap(prev => ({ ...prev, [uid]: thumbnailSrc }));
        }
      }, 400);
    },
    [
      activeViewportId,
      commandsManager,
      servicesManager,
      isHangingProtocolLayout,
      customizationService,
      displaySetService,
      dataSource,
      getImageSrc,
    ]
  );

  useEffect(() => {
    Object.assign(studyPanelLoadSession.thumbnailImageSrcMap, thumbnailImageSrcMap);
  }, [thumbnailImageSrcMap]);

  // ~~ studyDisplayList
  useEffect(() => {
    if (!StudyInstanceUIDs.length) {
      setIsStudyPanelLoading(false);
      return;
    }

    const allAlreadyFetched = StudyInstanceUIDs.every(uid => fetchedStudiesRef.current.has(uid));
    if (allAlreadyFetched) {
      setIsStudyPanelLoading(false);
      const cachedList = studyPanelLoadSession.studyDisplayLists.get(sessionKey);
      if (cachedList?.length) {
        setStudyDisplayList(cachedList);
      }
      return;
    }

    let isUnmounted = false;
    setIsStudyPanelLoading(true);

    // Fetch all studies for the patient in each primary study
    async function fetchStudiesForPatient(StudyInstanceUID) {
      // Skip fetching if we've already fetched this study
      if (fetchedStudiesRef.current.has(StudyInstanceUID)) {
        return;
      }

      fetchedStudiesRef.current.add(StudyInstanceUID);

      // current study qido
      const qidoForStudyUID = await dataSource.query.studies.search({
        studyInstanceUid: StudyInstanceUID,
      });

      if (!qidoForStudyUID?.length) {
        navigate('/notfoundstudy', '_self');
        throw new Error('Invalid study URL');
      }

      let qidoStudiesForPatient = qidoForStudyUID;

      // try to fetch the prior studies based on the patientID if the
      // server can respond.
      try {
        qidoStudiesForPatient = await getStudiesForPatientByMRN(qidoForStudyUID);
      } catch (error) {
        console.warn(error);
      }

      const mappedStudies = _mapDataSourceStudies(qidoStudiesForPatient);
      const actuallyMappedStudies = mappedStudies.map(qidoStudy => {
        return {
          studyInstanceUid: qidoStudy.StudyInstanceUID,
          date: formatDate(qidoStudy.StudyDate) || '',
          description: qidoStudy.StudyDescription,
          modalities: qidoStudy.ModalitiesInStudy,
          numInstances: Number(qidoStudy.NumInstances),
        };
      });

      setStudyDisplayList(prevArray => {
        const ret = [...prevArray];
        for (const study of actuallyMappedStudies) {
          if (!prevArray.find(it => it.studyInstanceUid === study.studyInstanceUid)) {
            ret.push(study);
          }
        }
        if (sessionKey) {
          studyPanelLoadSession.studyDisplayLists.set(sessionKey, ret);
        }
        return ret;
      });
    }

    Promise.all(StudyInstanceUIDs.map(sid => fetchStudiesForPatient(sid))).finally(() => {
      if (!isUnmounted) {
        setIsStudyPanelLoading(false);
      }
    });

    return () => {
      isUnmounted = true;
    };
  }, [StudyInstanceUIDs, dataSource, getStudiesForPatientByMRN, navigate, sessionKey]);

  // ~~ Initial Thumbnails
  useEffect(() => {
    if (!hasLoadedViewports) {
      if (activeViewportId) {
        // Once there is an active viewport id, it means the layout is ready
        // so wait a bit of time to allow the viewports preferential loading
        // which improves user experience of responsiveness significantly on slower
        // systems.
        const delayMs = 250 + displaySetService.getActiveDisplaySets().length * 10;
        window.setTimeout(() => setHasLoadedViewports(true), delayMs);
      }

      return;
    }

    let currentDisplaySets = displaySetService.activeDisplaySets;
    // filter non based on the list of modalities that are supported by cornerstone
    currentDisplaySets = currentDisplaySets.filter(
      ds => !thumbnailNoImageModalities.includes(ds.Modality) || ds.thumbnailSrc === null
    );

    if (!currentDisplaySets.length) {
      return;
    }

    currentDisplaySets.forEach(async dSet => {
      const displaySet = displaySetService.getDisplaySetByUID(dSet.displaySetInstanceUID);
      if (displaySet?.unsupported) {
        return;
      }
      const thumbnailSrc = await loadThumbnailForDisplaySet({
        displaySet,
        dataSource,
        getImageSrc,
      });
      if (!thumbnailSrc) {
        return;
      }
      setThumbnailImageSrcMap(prevState => ({
        ...prevState,
        [dSet.displaySetInstanceUID]: thumbnailSrc,
      }));
    });
  }, [displaySetService, dataSource, getImageSrc, activeViewportId, hasLoadedViewports]);

  // ~~ displaySets
  useEffect(() => {
    applyDefaultStudyBrowserSortIfNeeded();
    const currentDisplaySets = displaySetService.activeDisplaySets;

    if (!currentDisplaySets.length) {
      return;
    }

    // Merge prefetcher loading state so progress bar shows current progress on mount
    let loadingState = displaySetsLoadingState;
    if (studyPrefetcherService?.getDisplaySetLoadProgress) {
      loadingState = { ...displaySetsLoadingState };
      currentDisplaySets.forEach(ds => {
        const uid = ds.displaySetInstanceUID;
        if (loadingState[uid] == null) {
          const p = studyPrefetcherService.getDisplaySetLoadProgress(uid);
          if (p) {
            loadingState[uid] = {
              loadingProgress: p.loadingProgress,
              numInstances: p.numInstances,
              showStudyPanelProgress: p.showStudyPanelProgress,
            };
          }
        }
      });
    }

    const mappedDisplaySets = finalizeMappedDisplaySetsForProgressVisibility(
      mapDisplaySetsWithState(
        currentDisplaySets,
        loadingState,
        thumbnailImageSrcMap,
        viewports,
        isHangingProtocolLayout
      )
    );

    if (!customMapDisplaySets) {
      sortStudyInstances(mappedDisplaySets);
    }

    setDisplaySets(mappedDisplaySets);
  }, [
    applyDefaultStudyBrowserSortIfNeeded,
    displaySetService.activeDisplaySets,
    displaySetsLoadingState,
    viewports,
    thumbnailImageSrcMap,
    customMapDisplaySets,
    isHangingProtocolLayout,
    studyPrefetcherService,
    finalizeMappedDisplaySetsForProgressVisibility,
  ]);

  // ~~ subscriptions --> displaySets
  useEffect(() => {
    // DISPLAY_SETS_ADDED returns an array of DisplaySets that were added
    const SubscriptionDisplaySetsAdded = displaySetService.subscribe(
      displaySetService.EVENTS.DISPLAY_SETS_ADDED,
      data => {
        if (!hasLoadedViewports) {
          return;
        }
        const { displaySetsAdded, options } = data;
        displaySetsAdded.forEach(async dSet => {
          const displaySetInstanceUID = dSet.displaySetInstanceUID;
          const displaySet = displaySetService.getDisplaySetByUID(displaySetInstanceUID);
          if (displaySet?.unsupported) {
            return;
          }
          if (options?.madeInClient) {
            setJumpToDisplaySet(displaySetInstanceUID);
          }

          const thumbnailSrc = await loadThumbnailForDisplaySet({
            displaySet,
            dataSource,
            getImageSrc,
          });
          if (!thumbnailSrc) {
            return;
          }

          setThumbnailImageSrcMap(prevState => ({
            ...prevState,
            [displaySetInstanceUID]: thumbnailSrc,
          }));
        });
      }
    );

    return () => {
      SubscriptionDisplaySetsAdded.unsubscribe();
    };
  }, [displaySetService, dataSource, getImageSrc, hasLoadedViewports]);

  useEffect(() => {
    // TODO: Will this always hold _all_ the displaySets we care about?
    // DISPLAY_SETS_CHANGED returns `DisplaySerService.activeDisplaySets`
    const SubscriptionDisplaySetsChanged = displaySetService.subscribe(
      displaySetService.EVENTS.DISPLAY_SETS_CHANGED,
      changedDisplaySets => {
        applyDefaultStudyBrowserSortIfNeeded();
        const mappedDisplaySets = finalizeMappedDisplaySetsForProgressVisibility(
          mapDisplaySetsWithState(
            changedDisplaySets,
            displaySetsLoadingState,
            thumbnailImageSrcMap,
            viewports,
            isHangingProtocolLayout
          )
        );

        if (!customMapDisplaySets) {
          sortStudyInstances(mappedDisplaySets);
        }

        setDisplaySets(mappedDisplaySets);
      }
    );

    const SubscriptionDisplaySetMetaDataInvalidated = displaySetService.subscribe(
      displaySetService.EVENTS.DISPLAY_SET_SERIES_METADATA_INVALIDATED,
      () => {
        applyDefaultStudyBrowserSortIfNeeded();
        const mappedDisplaySets = finalizeMappedDisplaySetsForProgressVisibility(
          mapDisplaySetsWithState(
            displaySetService.getActiveDisplaySets(),
            displaySetsLoadingState,
            thumbnailImageSrcMap,
            viewports,
            isHangingProtocolLayout
          )
        );

        if (!customMapDisplaySets) {
          sortStudyInstances(mappedDisplaySets);
        }

        setDisplaySets(mappedDisplaySets);
      }
    );

    return () => {
      SubscriptionDisplaySetsChanged.unsubscribe();
      SubscriptionDisplaySetMetaDataInvalidated.unsubscribe();
    };
  }, [
    applyDefaultStudyBrowserSortIfNeeded,
    displaySetsLoadingState,
    thumbnailImageSrcMap,
    viewports,
    displaySetService,
    customMapDisplaySets,
    isHangingProtocolLayout,
    finalizeMappedDisplaySetsForProgressVisibility,
  ]);

  const tabs = createStudyBrowserTabs(StudyInstanceUIDs, studyDisplayList, displaySets);

  function _handleStudyClick(StudyInstanceUID) {
    if (expandedStudyInstanceUIDs.includes(StudyInstanceUID)) {
      return;
    }

    setExpandedStudyInstanceUIDs([...expandedStudyInstanceUIDs, StudyInstanceUID]);
    const madeInClient = true;
    requestDisplaySetCreationForStudy(displaySetService, StudyInstanceUID, madeInClient);
  }

  useEffect(() => {
    if (jumpToDisplaySet) {
      // Get element by displaySetInstanceUID
      const displaySetInstanceUID = jumpToDisplaySet;
      const element = document.getElementById(`thumbnail-${displaySetInstanceUID}`);

      if (element && typeof element.scrollIntoView === 'function') {
        // TODO: Any way to support IE here?
        element.scrollIntoView({ behavior: 'smooth' });

        setJumpToDisplaySet(null);
      }
    }
  }, [jumpToDisplaySet, expandedStudyInstanceUIDs, activeTabName]);

  useEffect(() => {
    if (!jumpToDisplaySet) {
      return;
    }

    const displaySetInstanceUID = jumpToDisplaySet;
    // It is possible to navigate to a study not currently in view
    const thumbnailLocation = _findTabAndStudyOfDisplaySet(displaySetInstanceUID, tabs, activeTabName);
    if (!thumbnailLocation) {
      return;
    }
    const { tabName, StudyInstanceUID } = thumbnailLocation;
    setActiveTabName(tabName);
    const studyExpanded = expandedStudyInstanceUIDs.includes(StudyInstanceUID);
    if (!studyExpanded) {
      const updatedExpandedStudyInstanceUIDs = [...expandedStudyInstanceUIDs, StudyInstanceUID];
      setExpandedStudyInstanceUIDs(updatedExpandedStudyInstanceUIDs);
    }
  }, [expandedStudyInstanceUIDs, jumpToDisplaySet, tabs]);

  const studyLoadingPercent = useMemo(() => {
    const activeDisplaySets = displaySetService.getActiveDisplaySets?.() || [];
    if (!activeDisplaySets.length) {
      return 100;
    }

    // Initial study panel loading should track only the first display set.
    // Remaining instances/series continue in background without blocking the panel.
    const firstDisplaySet = activeDisplaySets[0];
    if (
      thumbnailNoImageModalities.includes(firstDisplaySet?.Modality) ||
      isStructuredReportDisplaySet(firstDisplaySet)
    ) {
      return 100;
    }
    const uid = firstDisplaySet?.displaySetInstanceUID;
    if (!uid) {
      return 100;
    }
    const fromState = displaySetsLoadingState?.[uid];
    const fromPrefetcher = studyPrefetcherService?.getDisplaySetLoadProgress?.(uid);
    const raw = fromState ?? fromPrefetcher;
    const progress = typeof raw === 'object' && raw != null ? raw.loadingProgress : raw;
    const normalized =
      typeof progress === 'number' && !Number.isNaN(progress)
        ? Math.max(0, Math.min(1, progress))
        : 0;
    return Math.round(normalized * 100);
  }, [displaySetService, displaySetsLoadingState, studyPrefetcherService, displaySets.length]);

  const hasRenderableDisplaySets = displaySetService.getActiveDisplaySets?.().length > 0;
  const hasViewportReadyWithDisplaySet = useMemo(() => {
    if (!viewports?.size) {
      return false;
    }
    for (const viewport of viewports.values()) {
      if (!viewport?.displaySetInstanceUIDs?.length) {
        continue;
      }
      if (viewport.isReady === true) {
        return true;
      }
      if (viewportHasOnlyNonImageDisplaySets(viewport, displaySetService)) {
        return true;
      }
    }
    return false;
  }, [viewports, displaySetService]);

  const [hasSeenFirstViewportReady, setHasSeenFirstViewportReady] = useState(hasCachedViewportReady);
  useEffect(() => {
    if (hasViewportReadyWithDisplaySet && !hasSeenFirstViewportReady) {
      setHasSeenFirstViewportReady(true);
      if (sessionKey) {
        studyPanelLoadSession.viewportReadySessionKeys.add(sessionKey);
      }
    }
  }, [hasViewportReadyWithDisplaySet, hasSeenFirstViewportReady, sessionKey]);

  useEffect(() => {
    const key = getStudySessionKey(StudyInstanceUIDs);
    setHasSeenFirstViewportReady(
      key !== '' && studyPanelLoadSession.viewportReadySessionKeys.has(key)
    );
    setHasLoadedViewports(key !== '' && studyPanelLoadSession.viewportReadySessionKeys.has(key));
    setPrefetchProgressTrackByUid({});
  }, [StudyInstanceUIDs.join(',')]);

  // Hide study panel loader as soon as first viewport is ready (first image available).
  const showInitialStudyLoading =
    isStudyPanelLoading ||
    (!hasSeenFirstViewportReady && hasRenderableDisplaySets && !hasViewportReadyWithDisplaySet);
  // MoreDropdownMenu internally uses hooks, so compute menu components unconditionally
  // to keep PanelStudyBrowser hook order stable across loading/non-loading renders.
  const thumbnailMenuItems = MoreDropdownMenu({
    commandsManager,
    servicesManager,
    menuItemsKey: 'studyBrowser.thumbnailMenuItems',
  });
  const studyMenuItems = MoreDropdownMenu({
    commandsManager,
    servicesManager,
    menuItemsKey: 'studyBrowser.studyMenuItems',
  });

  return (
    <>
      <>
        <PanelStudyBrowserHeader
          viewPresets={viewPresets}
          updateViewPresetValue={updateViewPresetValue}
          actionIcons={actionIcons}
          updateActionIconValue={updateActionIconValue}
        />
        <Separator
          orientation="horizontal"
          className="bg-black"
          thickness="2px"
        />
      </>

      {showInitialStudyLoading ? (
        <div className="flex h-full min-h-[120px] items-center justify-center px-3">
          <div className="w-full max-w-[240px] space-y-2">
            <div className="text-primary-light text-center text-xs font-medium">
              Loading studies... {studyLoadingPercent}%
            </div>
            <ProgressLoadingBar progress={studyLoadingPercent} />
          </div>
        </div>
      ) : (
        <StudyBrowser
          tabs={tabs}
          servicesManager={servicesManager}
          activeTabName={activeTabName}
          expandedStudyInstanceUIDs={expandedStudyInstanceUIDs}
          onClickStudy={_handleStudyClick}
          onClickTab={clickedTabName => {
            setActiveTabName(clickedTabName);
          }}
          onClickUntrack={onClickUntrack}
          onClickThumbnail={() => {}}
          onDoubleClickThumbnail={onDoubleClickThumbnailHandler}
          activeDisplaySetInstanceUIDs={activeDisplaySetInstanceUIDs}
          onPrefetchDisplaySet={
            studyPrefetcherService?.prefetchDisplaySet ? handlePrefetchDisplaySet : undefined
          }
          showSettings={actionIcons.find(icon => icon.id === 'settings')?.value}
          viewPresets={viewPresets}
          ThumbnailMenuItems={thumbnailMenuItems}
          StudyMenuItems={studyMenuItems}
        />
      )}
    </>
  );
}

export default PanelStudyBrowser;

/**
 * Maps from the DataSource's format to a naturalized object
 *
 * @param {*} studies
 */
function _mapDataSourceStudies(studies) {
  return studies.map(study => {
    // TODO: Why does the data source return in this format?
    return {
      AccessionNumber: study.accession,
      StudyDate: study.date,
      StudyDescription: study.description,
      NumInstances: study.instances,
      ModalitiesInStudy: study.modalities,
      PatientID: study.mrn,
      PatientName: study.patientName,
      StudyInstanceUID: study.studyInstanceUid,
      StudyTime: study.time,
    };
  });
}

/**
 * Display set UIDs that are currently in viewports which are still loading (e.g. after switching to MPR/3D).
 */
function _getLayoutLoadingDisplaySetUIDs(viewports, isHangingProtocolLayout) {
  if (!isHangingProtocolLayout || !viewports || !viewports.size) {
    return new Set();
  }
  const uids = new Set();
  for (const viewport of viewports.values()) {
    if (viewport.isReady === false && viewport.displaySetInstanceUIDs?.length) {
      viewport.displaySetInstanceUIDs.forEach(uid => uids.add(uid));
    }
  }
  return uids;
}

/**
 * Per-thumbnail instance load progress (bar + percent) is noisy if shown for every series.
 * Only show it for the active viewport's series or series the user explicitly preloaded.
 * `loadingProgress` is still passed through so preload / "fully loaded" logic stays correct.
 */
function applyStudyBrowserSeriesProgressVisibility(
  mappedThumbnails,
  activeDisplaySetInstanceUIDs,
  prefetchProgressTrackByUid
) {
  const active = new Set(activeDisplaySetInstanceUIDs || []);
  return mappedThumbnails.map(t => {
    if (t.modality === 'SR') {
      return {
        ...t,
        showInstanceLoadProgressUi: false,
        showStudyPanelProgress: false,
        isLayoutLoading: false,
      };
    }

    const uid = t.displaySetInstanceUID;
    const showUi = active.has(uid) || Boolean(prefetchProgressTrackByUid[uid]);
    if (showUi) {
      return { ...t, showInstanceLoadProgressUi: true };
    }
    return { ...t, showInstanceLoadProgressUi: false, isLayoutLoading: false };
  });
}

function _mapDisplaySets(
  displaySets,
  displaySetLoadingState,
  thumbnailImageSrcMap,
  viewports,
  isHangingProtocolLayout = false
) {
  const layoutLoadingUIDs = _getLayoutLoadingDisplaySetUIDs(viewports, isHangingProtocolLayout);
  const thumbnailDisplaySets = [];
  const thumbnailNoImageDisplaySets = [];
  displaySets
    .filter(ds => !ds.excludeFromThumbnailBrowser)
    .forEach(ds => {
      const { thumbnailSrc, displaySetInstanceUID } = ds;
      const componentType = _getComponentType(ds);

      const array =
        componentType === 'thumbnail' ? thumbnailDisplaySets : thumbnailNoImageDisplaySets;

      const raw = displaySetLoadingState?.[displaySetInstanceUID];
      const loadingProgress =
        typeof raw === 'object' && raw != null ? raw.loadingProgress : raw;
      const loadingNumInstances =
        typeof raw === 'object' && raw != null ? raw.numInstances : undefined;
      const showStudyPanelProgress = Boolean(
        typeof raw === 'object' && raw != null && raw.showStudyPanelProgress
      );
      const isLayoutLoading = layoutLoadingUIDs.has(displaySetInstanceUID);

      array.push({
        displaySetInstanceUID,
        description: ds.SeriesDescription || '',
        seriesNumber: ds.SeriesNumber,
        InstanceNumber: ds.instanceNumber ?? ds.InstanceNumber,
        instanceNumber: ds.instanceNumber ?? ds.InstanceNumber,
        modality: ds.Modality,
        seriesDate: formatDate(ds.SeriesDate),
        numInstances: loadingNumInstances ?? ds.numImageFrames,
        loadingProgress,
        showStudyPanelProgress,
        isLayoutLoading,
        countIcon: ds.countIcon,
        messages: ds.messages,
        StudyInstanceUID: ds.StudyInstanceUID,
        componentType,
        imageSrc: thumbnailSrc || thumbnailImageSrcMap[displaySetInstanceUID],
        dragData: {
          type: 'displayset',
          displaySetInstanceUID,
          // .. Any other data to pass
        },
        isHydratedForDerivedDisplaySet: ds.isHydrated,
      });
    });

  return [...thumbnailDisplaySets, ...thumbnailNoImageDisplaySets];
}

function _getComponentType(ds) {
  if (
    thumbnailNoImageModalities.includes(ds.Modality) ||
    ds?.unsupported ||
    ds.thumbnailSrc === null
  ) {
    return 'thumbnailNoImage';
  }

  return 'thumbnail';
}

function getImageIdForThumbnail(displaySet, imageIds) {
  let imageId;
  if (displaySet.isDynamicVolume) {
    const timePoints = displaySet.dynamicVolumeInfo.timePoints;
    const middleIndex = Math.floor(timePoints.length / 2);
    const middleTimePointImageIds = timePoints[middleIndex];
    imageId = middleTimePointImageIds[Math.floor(middleTimePointImageIds.length / 2)];
  } else if (imageIds?.length) {
    imageId = imageIds[Math.floor(imageIds.length / 2)];
  }
  return imageId ? normalizeJpegImageId(imageId) : imageId;
}

async function loadThumbnailForDisplaySet({ displaySet, dataSource, getImageSrc }) {
  if (!displaySet || displaySet.unsupported) {
    return null;
  }

  const imageIds = dataSource.getImageIdsForDisplaySet(displaySet);
  const imageId = getImageIdForThumbnail(displaySet, imageIds);

  if (!imageId) {
    return null;
  }

  let thumbnailSrc = displaySet.thumbnailSrc;

  if (!thumbnailSrc && displaySet.getThumbnailSrc) {
    try {
      thumbnailSrc = await displaySet.getThumbnailSrc({ getImageSrc });
    } catch {
      thumbnailSrc = null;
    }
  }

  if (!thumbnailSrc) {
    try {
      thumbnailSrc = await getImageSrc(imageId);
    } catch (error) {
      console.warn('Study browser thumbnail failed', displaySet.displaySetInstanceUID, error);
      return null;
    }
  }

  if (thumbnailSrc) {
    displaySet.thumbnailSrc = thumbnailSrc;
  }

  return thumbnailSrc;
}

function _findTabAndStudyOfDisplaySet(
  displaySetInstanceUID: string,
  tabs: TabsProps,
  currentTabName: string
) {
  const current = tabs.find(tab => tab.name===currentTabName) || tabs[0];
  const biasedTabs = [current, ...tabs];

  for (let t = 0; t < biasedTabs.length; t++) {
    const study = biasedTabs[t].studies.find(study => study.displaySets.find(ds => ds.displaySetInstanceUID ===displaySetInstanceUID));
    if (study) {
      return {
        tabName: biasedTabs[t].name,
        StudyInstanceUID: study.studyInstanceUid,
      };
    }
  }
}
