import getStudies from './studiesList';
import { DicomMetadataStore, log, utils, Enums } from '@ohif/core';
import isSeriesFilterUsed from '../../utils/isSeriesFilterUsed';

const { getSplitParam } = utils;

/**
 * Initialize the route.
 *
 * @param props.servicesManager to read services from
 * @param props.studyInstanceUIDs for a list of studies to read
 * @param props.dataSource to read the data from
 * @param props.filters filters from query params to read the data from
 * @returns array of subscriptions to cancel
 */
export async function defaultRouteInit(
  { servicesManager, studyInstanceUIDs, dataSource, filters, appConfig }: withAppTypes,
  hangingProtocolId,
  stageIndex
) {
  const { displaySetService, hangingProtocolService, uiNotificationService, customizationService } =
    servicesManager.services;

  const loadSeriesMetadataOnDemand = appConfig?.loadSeriesMetadataOnDemand === true;
  // When loading on demand, use 'default' (1x1) for initial load so only one series is loaded;
  // user sees single viewport first; switching to 2x2 etc. is fast after background load.
  const initialHangingProtocolId =
    loadSeriesMetadataOnDemand ? 'default' : hangingProtocolId;
  const placeholderDisplaySetUIDsBySeries = new Map<string, string>(); // SeriesInstanceUID -> placeholder displaySetInstanceUID

  /**
   * Function to apply the hanging protocol when the minimum number of display sets were
   * received or all display sets retrieval were completed.
   * When loadSeriesMetadataOnDemand is true, uses 'default' (1x1) for initial display.
   * @returns
   */
  function applyHangingProtocol(protocolIdToUse?: string) {
    const displaySets = displaySetService.getActiveDisplaySets();

    if (!displaySets || !displaySets.length) {
      return;
    }

    // Gets the studies list to use
    const studies = getStudies(studyInstanceUIDs, displaySets);

    // study being displayed, and is thus the "active" study.
    const activeStudy = studies[0];

    const protocolId = protocolIdToUse ?? initialHangingProtocolId;
    // run the hanging protocol matching on the displaySets with the predefined
    // hanging protocol (default 1x1 when loading on demand for fast first paint)
    hangingProtocolService.run({ studies, activeStudy, displaySets }, protocolId, {
      stageIndex,
    });
  }

  const unsubscriptions = [];
  const issuedWarningSeries = [];
  const { unsubscribe: instanceAddedUnsubscribe } = DicomMetadataStore.subscribe(
    DicomMetadataStore.EVENTS.INSTANCES_ADDED,
    function ({ StudyInstanceUID, SeriesInstanceUID, madeInClient = false }) {
      const seriesMetadata = DicomMetadataStore.getSeries(StudyInstanceUID, SeriesInstanceUID);

      // Remove placeholder for this series when real instances are added
      const placeholderUID = placeholderDisplaySetUIDsBySeries.get(SeriesInstanceUID);
      if (placeholderUID) {
        placeholderDisplaySetUIDsBySeries.delete(SeriesInstanceUID);
        displaySetService.deleteDisplaySet(placeholderUID);
      }

      // checks if the series filter was used, if it exists
      const seriesInstanceUIDs = filters?.seriesInstanceUID;
      if (
        seriesInstanceUIDs?.length &&
        !isSeriesFilterUsed(seriesMetadata.instances, filters) &&
        !issuedWarningSeries.includes(seriesInstanceUIDs[0])
      ) {
        // stores the series instance filter so it shows only once the warning
        issuedWarningSeries.push(seriesInstanceUIDs[0]);
        uiNotificationService.show({
          title: 'Series filter',
          message: `Each of the series in filter: ${seriesInstanceUIDs} are not part of the current study. The entire study is being displayed`,
          type: 'error',
          duration: 7000,
        });
      }

      displaySetService.makeDisplaySets(seriesMetadata.instances, { madeInClient });
    }
  );

  unsubscriptions.push(instanceAddedUnsubscribe);

  log.time(Enums.TimingEnum.STUDY_TO_DISPLAY_SETS);
  log.time(Enums.TimingEnum.STUDY_TO_FIRST_IMAGE);

  const allRetrieves = studyInstanceUIDs.map(StudyInstanceUID =>
    dataSource.retrieve.series.metadata({
      StudyInstanceUID,
      filters,
      returnPromises: true,
      sortCriteria: customizationService.getCustomization('sortingCriteria'),
    })
  );

  // log the error if this fails, otherwise it's so difficult to tell what went wrong...
  allRetrieves.forEach(retrieve => {
    retrieve.catch(error => {
      console.error(error);
    });
  });

  // is displaysets from URL and has initialSOPInstanceUID or initialSeriesInstanceUID
  // then we need to wait for all display sets to be retrieved before applying the hanging protocol
  const params = new URLSearchParams(window.location.search);

  const initialSeriesInstanceUID = getSplitParam('initialseriesinstanceuid', params);
  const initialSOPInstanceUID = getSplitParam('initialsopinstanceuid', params);

  let displaySetFromUrl = false;
  if (initialSeriesInstanceUID || initialSOPInstanceUID) {
    displaySetFromUrl = true;
  }

  await Promise.allSettled(allRetrieves).then(async promises => {
    log.timeEnd(Enums.TimingEnum.STUDY_TO_DISPLAY_SETS);
    log.time(Enums.TimingEnum.DISPLAY_SETS_TO_FIRST_IMAGE);
    log.time(Enums.TimingEnum.DISPLAY_SETS_TO_ALL_IMAGES);

    const allPromises = [];
    const remainingPromises = [];

    function startRemainingPromises(remainingPromises) {
      remainingPromises.forEach(p => p.forEach(pr => pr.start()));
    }

    promises.forEach(promise => {
      const raw = promise.value;
      const retrieveSeriesMetadataPromise = Array.isArray(raw)
        ? raw
        : raw?.promises;
      const preLoadData = raw?.preLoadData;

      if (!retrieveSeriesMetadataPromise || !Array.isArray(retrieveSeriesMetadataPromise)) {
        return;
      }

      if (displaySetFromUrl) {
        const requiredSeriesPromises = retrieveSeriesMetadataPromise.map(pr => pr.start());
        allPromises.push(Promise.allSettled(requiredSeriesPromises));
      } else {
        const { requiredSeries, remaining } = hangingProtocolService.filterSeriesRequiredForRun(
          initialHangingProtocolId,
          retrieveSeriesMetadataPromise
        );
        const requiredSeriesPromises = requiredSeries.map(pr => pr.start());
        allPromises.push(Promise.allSettled(requiredSeriesPromises));
        remainingPromises.push(remaining);

        // On-demand: add placeholder display sets for remaining series so user can click to load
        if (loadSeriesMetadataOnDemand && remaining?.length && preLoadData?.length) {
          const protocolId = Array.isArray(initialHangingProtocolId) ? initialHangingProtocolId[0] : initialHangingProtocolId;
          const minLoaded =
            hangingProtocolService.getProtocolById(protocolId)?.hpInitiationCriteria
              ?.minSeriesLoaded ?? 1;
          const remainingSummaries = preLoadData.slice(minLoaded);
          const placeholders = remainingSummaries.map((seriesMeta: { StudyInstanceUID: string; SeriesInstanceUID: string; SeriesDescription?: string; SeriesNumber?: number; Modality?: string }) => {
            const uid = `placeholder:${seriesMeta.SeriesInstanceUID}`;
            placeholderDisplaySetUIDsBySeries.set(seriesMeta.SeriesInstanceUID, uid);
            return {
              displaySetInstanceUID: uid,
              instances: [],
              StudyInstanceUID: seriesMeta.StudyInstanceUID,
              SeriesInstanceUID: seriesMeta.SeriesInstanceUID,
              SeriesDescription: seriesMeta.SeriesDescription,
              SeriesNumber: seriesMeta.SeriesNumber,
              Modality: seriesMeta.Modality,
              numImages: 0,
              isSeriesPlaceholder: true,
              viewportType: 'stack',
            };
          });
          if (placeholders.length) {
            displaySetService.addDisplaySets(...placeholders);
          }
        }
      }
    });

    await Promise.allSettled(allPromises).then(() => {
      applyHangingProtocol();
      // When loadSeriesMetadataOnDemand is true: load only the first N series in background
      // so thumbnails appear for them; rest load when user clicks (ensureSeriesLoaded).
      const backgroundCount = appConfig?.loadSeriesMetadataOnDemandBackgroundCount ?? 5;
      if (loadSeriesMetadataOnDemand && remainingPromises.length > 0 && backgroundCount > 0) {
        const scheduleBackgroundLoad = () => {
          const toStart = remainingPromises.flat().slice(0, backgroundCount);
          toStart.forEach(pr => pr.start?.());
        };
        if (typeof requestIdleCallback !== 'undefined') {
          requestIdleCallback(scheduleBackgroundLoad, { timeout: 2000 });
        } else {
          setTimeout(scheduleBackgroundLoad, 500);
        }
      }
    });
    if (!loadSeriesMetadataOnDemand) {
      startRemainingPromises(remainingPromises);
    }
    applyHangingProtocol();
  });

  return unsubscriptions;
}
