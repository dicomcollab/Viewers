import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useLocation, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { Button, Header, Icons, useModal } from '@ohif/ui-next';
import {
  DicomMetadataStore,
  useSystem,
  Types,
  fetchRisViewDicomImg,
  getDefaultRisPortalOrigin,
  getRisAuthTokenFromBrowserCookies,
  resolveRisApiBaseFromConfig,
  resolveRisWorklistUrlFromConfig,
} from '@ohif/core';
import { Toolbar } from '../Toolbar/Toolbar';
import { preserveQueryParameters } from '@ohif/app';

function getFirstStudyInstanceUidFromSearch(search: string): string | null {
  const q = new URLSearchParams(search);
  const raw =
    q.get('StudyInstanceUIDs') ||
    q.get('studyInstanceUIDs') ||
    q.get('StudyInstanceUID') ||
    q.get('studyinstanceuid');
  if (!raw) {
    return null;
  }
  const first = raw.split(/[,\s]+/)[0]?.trim();
  return first || null;
}

/**
 * Study UID for report link: query string, route params, then loaded study in the viewer.
 * OHIF often uses /basic/datasource?StudyInstanceUIDs=… but metadata is always in the store once loaded.
 */
function resolveStudyInstanceUidForReport(
  search: string,
  params: Readonly<Record<string, string | undefined>>
): string | null {
  const fromQuery = getFirstStudyInstanceUidFromSearch(search);
  if (fromQuery) {
    return fromQuery;
  }

  const fromParams =
    params.StudyInstanceUIDs ||
    params.studyInstanceUIDs ||
    params.studyInstanceUid ||
    params.StudyInstanceUID;
  if (fromParams) {
    const first = String(fromParams).split(/[,\s]+/)[0]?.trim();
    if (first) {
      return first;
    }
  }

  try {
    const fromStore = DicomMetadataStore.getStudyInstanceUIDs?.();
    if (Array.isArray(fromStore) && fromStore.length > 0 && fromStore[0]) {
      return fromStore[0];
    }
  } catch {
    /* ignore */
  }

  return null;
}

/**
 * Report app origin: localhost:5173 (or createReportAppBaseUrl) when developing locally;
 * Synapse / Lens live uses createReportAppBaseUrlProduction or the origin of risWorklistUrl.
 */
function getCreateReportBaseUrl(appConfig: AppTypes.Config): string | null {
  if (typeof window === 'undefined') {
    return appConfig.createReportAppBaseUrl || null;
  }

  const host = window.location.hostname || '';
  const isLocalDev =
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '[::1]' ||
    host.endsWith('.local');

  if (isLocalDev) {
    const local = appConfig.createReportAppBaseUrl || 'http://localhost:5173';
    return local ? String(local).replace(/\/$/, '') : null;
  }

  if (appConfig.createReportAppBaseUrlProduction) {
    return String(appConfig.createReportAppBaseUrlProduction).replace(/\/$/, '');
  }

  const ris = resolveRisWorklistUrlFromConfig(appConfig);
  try {
    return new URL(ris).origin;
  } catch {
    return getDefaultRisPortalOrigin();
  }
}

function ViewerHeader({ appConfig, isIframeMode = false }: withAppTypes<{ appConfig: AppTypes.Config; isIframeMode?: boolean }>) {
  const { servicesManager, extensionManager, commandsManager } = useSystem();
  const useViewDicomForReport = Boolean(appConfig.risReportUseViewDicomApi);
  const { customizationService } = servicesManager.services;

  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams();

  /** Re-render when DicomMetadataStore gets study data so Report href works even if URL has no query. */
  const [, setMetadataRev] = useState(0);
  useEffect(() => {
    if (isIframeMode) {
      return;
    }
    if (!useViewDicomForReport) {
      return;
    }
    const refresh = () => setMetadataRev(r => r + 1);
    const { EVENTS } = DicomMetadataStore;
    const s1 = DicomMetadataStore.subscribe(EVENTS.INSTANCES_ADDED, refresh);
    const s2 = DicomMetadataStore.subscribe(EVENTS.SERIES_ADDED, refresh);
    const s3 = DicomMetadataStore.subscribe(EVENTS.SERIES_UPDATED, refresh);
    return () => {
      s1.unsubscribe();
      s2.unsubscribe();
      s3.unsubscribe();
    };
  }, [isIframeMode, useViewDicomForReport]);

  const handleReportViaViewDicomApi = useCallback(async () => {
    const { uiNotificationService } = servicesManager.services;
    const studyUid = resolveStudyInstanceUidForReport(location.search, params);
    if (!studyUid) {
      uiNotificationService.show({
        title: 'Report',
        message: 'No study is loaded (StudyInstanceUID missing).',
        type: 'error',
      });
      return;
    }
    const token = getRisAuthTokenFromBrowserCookies();
    if (!token) {
      uiNotificationService.show({
        title: 'Report',
        message: 'No RIS session token found. Sign in again or open the viewer from the worklist.',
        type: 'error',
      });
      return;
    }
    try {
      const apiBase = resolveRisApiBaseFromConfig(appConfig);
      const path = appConfig.risViewDicomImgPath;
      const { viewerUrl, dicomData } = await fetchRisViewDicomImg({
        studyUID: studyUid,
        token,
        apiBase,
        ...(path ? { path } : {}),
      });
      const dicomEntryId =
        dicomData?._id != null ? String(dicomData._id).trim() : '';
      if (dicomEntryId) {
        const reportBase = getCreateReportBaseUrl(appConfig);
        if (!reportBase) {
          uiNotificationService.show({
            title: 'Report',
            message: 'Report app base URL is not configured (createReportAppBaseUrl / production / risWorklistUrl).',
            type: 'error',
          });
          return;
        }
        const studyForPath =
          dicomData?.studyUID != null && String(dicomData.studyUID).trim()
            ? String(dicomData.studyUID).trim()
            : studyUid;
        const tempId = new URLSearchParams(location.search).get('tempId') ?? '';
        const root = reportBase.replace(/\/$/, '');
        window.location.assign(
          `${root}/createreport/${dicomEntryId}/${studyForPath}?tempId=${encodeURIComponent(tempId)}`
        );
        return;
      }
      if (viewerUrl) {
        window.location.assign(viewerUrl);
        return;
      }
      throw new Error('viewDicomImg: missing dicomData._id and data.url');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Could not open the report screen.';
      uiNotificationService.show({
        title: 'Report',
        message,
        type: 'error',
      });
    }
  }, [appConfig, location.search, params, servicesManager]);

  const onClickReturnButton = () => {
    const { pathname } = location;
    const dataSourceIdx = pathname.indexOf('/', 1);

    const dataSourceName = pathname.substring(dataSourceIdx + 1);
    const existingDataSource = extensionManager.getDataSources(dataSourceName);

    const searchQuery = new URLSearchParams();
    if (dataSourceIdx !== -1 && existingDataSource) {
      searchQuery.append('datasources', pathname.substring(dataSourceIdx + 1));
    }
    preserveQueryParameters(searchQuery);

    navigate({
      pathname: '/',
      search: decodeURIComponent(searchQuery.toString()),
    });
  };

  const { t } = useTranslation();
  const { show } = useModal();

  const AboutModal = customizationService.getCustomization(
    'ohif.aboutModal'
  ) as Types.MenuComponentCustomization;

  const UserPreferencesModal = customizationService.getCustomization(
    'ohif.userPreferencesModal'
  ) as Types.MenuComponentCustomization;

  const menuOptions = [
    {
      title: AboutModal?.menuTitle ?? t('Header:About'),
      icon: 'info',
      onClick: () =>
        show({
          content: AboutModal,
          title: AboutModal?.title ?? t('AboutModal:About MedPacs'),
          containerClassName: AboutModal?.containerClassName ?? 'max-w-md',
        }),
    },
    {
      title: UserPreferencesModal.menuTitle ?? t('Header:Preferences'),
      icon: 'settings',
      onClick: () =>
        show({
          content: UserPreferencesModal,
          title: UserPreferencesModal.title ?? t('UserPreferencesModal:User preferences'),
          containerClassName:
            UserPreferencesModal?.containerClassName ?? 'flex max-w-4xl p-6 flex-col',
        }),
    },
  ];

  if (appConfig.oidc) {
    menuOptions.push({
      title: t('Header:Logout'),
      icon: 'power-off',
      onClick: async () => {
        navigate(`/logout?redirect_uri=${encodeURIComponent(window.location.href)}`);
      },
    });
  }

  // Without viewDicom API: direct link to risReportUrl or worklist (no static createreport id).
  const reportNavigationHref = useViewDicomForReport
    ? undefined
    : appConfig.risReportUrl || resolveRisWorklistUrlFromConfig(appConfig);

  const onReportNavigation =
    !isIframeMode && useViewDicomForReport ? handleReportViaViewDicomApi : undefined;

  return (
    <Header
      menuOptions={menuOptions}
      isReturnEnabled={!!appConfig.showStudyList}
      onClickReturnButton={onClickReturnButton}
      WhiteLabeling={appConfig.whiteLabeling}
      reportNavigationHref={isIframeMode ? undefined : reportNavigationHref}
      onReportNavigation={onReportNavigation}
      Secondary={<Toolbar buttonSection="secondary" />}
      isIframeMode={isIframeMode}
      UndoRedo={
        <div className="text-primary flex cursor-pointer items-center">
          <Button
            variant="ghost"
            className="hover:bg-muted"
            data-cy="undo-btn"
            onClick={() => {
              commandsManager.run('undo');
            }}
          >
            <Icons.Undo className="" />
          </Button>
          <Button
            variant="ghost"
            className="hover:bg-muted"
            data-cy="redo-btn"
            onClick={() => {
              commandsManager.run('redo');
            }}
          >
            <Icons.Redo className="" />
          </Button>
        </div>
      }
    >
      <div className={`relative flex justify-center gap-[4px] overflow-x-auto overflow-y-hidden ${isIframeMode ? 'iframe-toolbar-compact' : ''}`}>
        <div className="flex items-center justify-center whitespace-nowrap">
          <Toolbar buttonSection="primary" />
        </div>
      </div>
    </Header>
  );
}

export default ViewerHeader;
