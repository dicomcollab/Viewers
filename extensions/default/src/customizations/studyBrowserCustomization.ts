import { utils } from '@ohif/core';
import i18n from '@ohif/i18n';
import { ensureStructuredReportDisplaySet } from '../utils/ensureStructuredReportDisplaySet';
import {
  buildViewportsUpdateForDisplaySet,
  isStructuredReportDisplaySet,
  resolveViewportIdForStructuredReport,
} from '../utils/openStructuredReportInViewport';

const { formatDate } = utils;

export default {
  'studyBrowser.studyMenuItems': [],
  'studyBrowser.thumbnailMenuItems': [
    {
      id: 'tagBrowser',
      label: i18n.t('StudyBrowser:Tag Browser'),
      iconName: 'DicomTagBrowser',
      commands: 'openDICOMTagViewer',
    },
    {
      id: 'addAsLayer',
      label: i18n.t('StudyBrowser:Add as Layer'),
      iconName: 'ViewportViews',
      commands: 'addDisplaySetAsLayer',
    },
  ],
  'studyBrowser.sortFunctions': [
    {
      label: i18n.t('StudyBrowser:Series Number'),
      sortFunction: (a, b) => {
        const numA = Number(a?.SeriesNumber);
        const numB = Number(b?.SeriesNumber);
        const finiteA = Number.isFinite(numA);
        const finiteB = Number.isFinite(numB);
        if (finiteA && finiteB) {
          if (numA !== numB) {
            return numA - numB;
          }
        } else {
          if (finiteA !== finiteB) {
            return finiteA ? -1 : 1;
          }
        }
        const dateA = Date.parse(`${a?.SeriesDate ?? ''} ${a?.SeriesTime ?? ''}`);
        const dateB = Date.parse(`${b?.SeriesDate ?? ''} ${b?.SeriesTime ?? ''}`);
        if (Number.isFinite(dateA) && Number.isFinite(dateB) && dateA !== dateB) {
          return dateA - dateB;
        }
        return (a?.SeriesInstanceUID ?? '').localeCompare(b?.SeriesInstanceUID ?? '');
      },
    },
    {
      label: i18n.t('StudyBrowser:Series Date'),
      sortFunction: (a, b) => {
        const dateA = new Date(formatDate(a?.SeriesDate));
        const dateB = new Date(formatDate(b?.SeriesDate));
        return dateB.getTime() - dateA.getTime();
      },
    },
  ],
  'studyBrowser.viewPresets': [
    {
      id: 'list',
      iconName: 'ListView',
      selected: false,
    },
    {
      id: 'thumbnails',
      iconName: 'ThumbnailView',
      selected: true,
    },
  ],
  'studyBrowser.studyMode': 'all',
  'studyBrowser.thumbnailDoubleClickCallback': {
    callbacks: [
      ({ activeViewportId, servicesManager, commandsManager, isHangingProtocolLayout }) =>
        async displaySetInstanceUID => {
          const { hangingProtocolService, displaySetService, uiNotificationService } =
            servicesManager.services;
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
              title: i18n.t('StudyBrowser:Thumbnail Double Click'),
              message: i18n.t(
                'StudyBrowser:This series is not supported in the viewer.'
              ),
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
            viewportGridService: servicesManager.services.viewportGridService,
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
              title: i18n.t('StudyBrowser:Thumbnail Double Click'),
              message: i18n.t(
                'StudyBrowser:The selected display sets could not be added to the viewport.'
              ),
              type: 'error',
              duration: 3000,
            });
            return;
          }

          commandsManager.run('setDisplaySetsForViewports', {
            viewportsToUpdate: updatedViewports,
          });
        },
    ],
  },
};
