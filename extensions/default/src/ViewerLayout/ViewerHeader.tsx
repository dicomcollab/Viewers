import React, { useEffect, useState } from 'react';
import { useNavigate, useLocation, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { Button, Header, Icons, useModal } from '@ohif/ui-next';
import { DicomMetadataStore, useSystem, Types } from '@ohif/core';
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

  const ris = appConfig.risWorklistUrl || 'https://synapse.med-pacs.com/worklist';
  try {
    return new URL(ris).origin;
  } catch {
    return 'https://synapse.med-pacs.com';
  }
}

/**
 * Build report-app URL: {base}/createreport/{contextId}/{studyUid}?tempId={tempId}
 * Matches RIS pattern; study UID kept unencoded in path (dots) like typical PACS UIDs.
 */
function buildCreateReportHref(
  appConfig: AppTypes.Config,
  search: string,
  params: Readonly<Record<string, string | undefined>>
): string | null {
  const base = getCreateReportBaseUrl(appConfig);
  if (!base) {
    return null;
  }
  const studyUid = resolveStudyInstanceUidForReport(search, params);
  if (!studyUid) {
    return null;
  }
  const q = new URLSearchParams(search);
  const contextId = q.get('reportContextId') || appConfig.createReportContextId;
  if (!contextId) {
    return null;
  }
  const tempId = q.get('tempId') ?? '';
  const root = String(base).replace(/\/$/, '');
  return `${root}/createreport/${contextId}/${studyUid}?tempId=${encodeURIComponent(tempId)}`;
}

function ViewerHeader({ appConfig, isIframeMode = false }: withAppTypes<{ appConfig: AppTypes.Config; isIframeMode?: boolean }>) {
  const { servicesManager, extensionManager, commandsManager } = useSystem();
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
    const q = new URLSearchParams(location.search);
    if (!appConfig.createReportContextId && !q.get('reportContextId')) {
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
  }, [appConfig.createReportContextId, location.search, isIframeMode]);

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

  // Createreport URL: local → localhost:5173; Lens live → Synapse origin from risWorklistUrl (or createReportAppBaseUrlProduction).
  const createReportHref = buildCreateReportHref(appConfig, location.search, params);
  const reportContextQ = new URLSearchParams(location.search);
  const wantsCreateReport =
    Boolean(appConfig.createReportContextId || reportContextQ.get('reportContextId')) &&
    Boolean(getCreateReportBaseUrl(appConfig));

  const reportNavigationHref = createReportHref
    ? createReportHref
    : wantsCreateReport
      ? null
      : appConfig.risReportUrl ||
        appConfig.risWorklistUrl ||
        'https://synapse.med-pacs.com/worklist';

  return (
    <Header
      menuOptions={menuOptions}
      isReturnEnabled={!!appConfig.showStudyList}
      onClickReturnButton={onClickReturnButton}
      WhiteLabeling={appConfig.whiteLabeling}
      reportNavigationHref={isIframeMode ? undefined : reportNavigationHref}
      Secondary={<Toolbar buttonSection="secondary" />}
      isIframeMode={isIframeMode}
      UndoRedo={
        <div className="text-primary flex cursor-pointer items-center">
          <Button
            variant="ghost"
            className="hover:bg-primary-dark"
            onClick={() => {
              commandsManager.run('undo');
            }}
          >
            <Icons.Undo className="" />
          </Button>
          <Button
            variant="ghost"
            className="hover:bg-primary-dark"
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
