import { measurementTrackingMode } from '../contexts/TrackedMeasurementsContext/promptBeginTracking';
import { ensureStructuredReportDisplaySet } from '@ohif/extension-default/src/utils/ensureStructuredReportDisplaySet';
import {
  buildViewportsUpdateForDisplaySet,
  isStructuredReportDisplaySet,
  resolveViewportIdForStructuredReport,
} from '@ohif/extension-default/src/utils/openStructuredReportInViewport';

type CheckHasDirtyAndSimplifiedModeProps = {
  servicesManager: AppTypes.ServicesManager;
  appConfig: AppTypes.Config;
  displaySetInstanceUID: string;
};

const onDoubleClickHandler = {
  callbacks: [
    ({ activeViewportId, servicesManager, commandsManager, isHangingProtocolLayout, appConfig }) =>
      async displaySetInstanceUID => {
        const { hangingProtocolService, displaySetService, viewportGridService, uiNotificationService } =
          servicesManager.services;
        const haveDirtyMeasurementsInSimplifiedMode = checkHasDirtyAndSimplifiedMode({
          servicesManager,
          appConfig,
          displaySetInstanceUID,
        });

        if (haveDirtyMeasurementsInSimplifiedMode) {
          return;
        }

        const extensionManager =
          commandsManager?.extensionManager || (typeof window !== 'undefined' && window.extensionManager);
        const dataSource = extensionManager?.getActiveDataSource?.()?.[0];

        let displaySet = displaySetService.getDisplaySetByUID(displaySetInstanceUID);

        if (displaySet?.unsupported) {
          displaySet = await ensureStructuredReportDisplaySet(displaySet, {
            dataSource,
            displaySetService,
          });
        }

        if (!displaySet || displaySet.unsupported) {
          uiNotificationService.show({
            title: 'Thumbnail Double Click',
            message: 'This series is not supported in the viewer.',
            type: 'warning',
            duration: 4000,
          });
          return;
        }

        if (isStructuredReportDisplaySet(displaySet) && typeof displaySet.load === 'function') {
          displaySet.isLoaded = false;
          displaySet._loadPromise = null;
          try {
            await displaySet.load();
          } catch (error) {
            console.warn('[SR] Unable to load structured report', error);
          }
        }

        const viewportId = resolveViewportIdForStructuredReport(displaySet, {
          activeViewportId,
          viewportGridService,
          displaySetService,
        });

        const updatedViewports = buildViewportsUpdateForDisplaySet(
          displaySetInstanceUID,
          viewportId,
          hangingProtocolService,
          isHangingProtocolLayout
        );

        if (!updatedViewports?.length) {
          uiNotificationService.show({
            title: 'Thumbnail Double Click',
            message: 'The selected display sets could not be added to the viewport.',
            type: 'error',
            duration: 3000,
          });
          return;
        }

        viewportGridService.setDisplaySetsForViewports(updatedViewports);
      },
  ],
};

const customOnDropHandlerCallback = async props => {
  const handled = checkHasDirtyAndSimplifiedMode(props);
  return Promise.resolve({ handled });
};

const checkHasDirtyAndSimplifiedMode = (props: CheckHasDirtyAndSimplifiedModeProps) => {
  const { servicesManager, appConfig, displaySetInstanceUID } = props;
  const simplifiedMode = appConfig.measurementTrackingMode === measurementTrackingMode.SIMPLIFIED;
  const { measurementService, displaySetService } = servicesManager.services;
  const measurements = measurementService.getMeasurements();
  const haveDirtyMeasurements =
    measurements.some(m => m.isDirty) ||
    (measurements.length && measurementService.getIsMeasurementDeletedIndividually());
  const displaySet = displaySetService.getDisplaySetByUID(displaySetInstanceUID);
  const hasDirtyAndSimplifiedMode =
    displaySet.Modality === 'SR' && simplifiedMode && haveDirtyMeasurements;
  return hasDirtyAndSimplifiedMode;
};

export { onDoubleClickHandler, customOnDropHandlerCallback };
