import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useLocation, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import {
  Button,
  Header,
  Icons,
  useModal,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
} from '@ohif/ui-next';
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
    const first = String(fromParams)
      .split(/[,\s]+/)[0]
      ?.trim();
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
    appConfig.isDev === true ||
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
    return getDefaultRisPortalOrigin(appConfig);
  }
}

function ViewerHeader({
  appConfig,
  isIframeMode = false,
  isMobileLayout = false,
  hasLeftPanels = false,
  hasRightPanels = false,
  leftPanelOpen = false,
  rightPanelOpen = false,
  onToggleLeftPanel,
  onToggleRightPanel,
}: withAppTypes<{
  appConfig: AppTypes.Config;
  isIframeMode?: boolean;
  isMobileLayout?: boolean;
  hasLeftPanels?: boolean;
  hasRightPanels?: boolean;
  leftPanelOpen?: boolean;
  rightPanelOpen?: boolean;
  onToggleLeftPanel?: () => void;
  onToggleRightPanel?: () => void;
}>) {
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
      const dicomEntryId = dicomData?._id != null ? String(dicomData._id).trim() : '';
      if (dicomEntryId) {
        const reportBase = getCreateReportBaseUrl(appConfig);
        if (!reportBase) {
          uiNotificationService.show({
            title: 'Report',
            message:
              'Report app base URL is not configured (createReportAppBaseUrl / production / risWorklistUrl).',
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

  // Without viewDicom API: direct link to risReportUrl or worklist (no static createreport id).
  const reportNavigationHref = useViewDicomForReport
    ? undefined
    : appConfig.risReportUrl || resolveRisWorklistUrlFromConfig(appConfig);

  const onReportNavigation =
    !isIframeMode && useViewDicomForReport ? handleReportViaViewDicomApi : undefined;

  // Mobile: Report lives in settings (header is too narrow for the Report button).
  if (isMobileLayout && (onReportNavigation || reportNavigationHref)) {
    menuOptions.unshift({
      title: t('Header:Report') !== 'Header:Report' ? t('Header:Report') : 'Report',
      icon: 'clipboard',
      onClick: () => {
        if (onReportNavigation) {
          void onReportNavigation();
        } else if (reportNavigationHref) {
          window.location.assign(reportNavigationHref);
        }
      },
    });
  }

  if (appConfig.oidc) {
    menuOptions.push({
      title: t('Header:Logout'),
      icon: 'power-off',
      onClick: async () => {
        navigate(`/logout?redirect_uri=${encodeURIComponent(window.location.href)}`);
      },
    });
  }

  const setMobileLayoutGrid = (numRows: number, numCols: number) => {
    try {
      commandsManager.runCommand('setViewportGridLayout', { numRows, numCols });
    } catch {
      try {
        commandsManager.run('setViewportGridLayout', { numRows, numCols });
      } catch {
        /* ignore */
      }
    }
  };

  const FPS_MIN = 1;
  const FPS_MAX = 90;
  const IMAGE_TOOLS = [
    { id: 'rotate', label: 'Rotate', command: 'rotateViewportCW', Icon: Icons.ToolRotateRight },
    { id: 'invert', label: 'Invert', command: 'invertViewport', Icon: Icons.ToolInvert },
    { id: 'reset', label: 'Reset', command: 'resetViewport', Icon: Icons.ToolReset },
    {
      id: 'flipH',
      label: 'Flip H',
      command: 'flipViewportHorizontal',
      Icon: Icons.ToolFlipHorizontal,
    },
  ] as const;

  const [selectedFps, setSelectedFps] = useState(25);
  // Default Rotate so the primary button is always actionable.
  const [selectedImageTool, setSelectedImageTool] = useState<string>('rotate');

  // Keep FPS stepper in sync with active viewport cine rate.
  useEffect(() => {
    if (!isMobileLayout) {
      return;
    }
    const { cineService, viewportGridService } = servicesManager.services;
    const syncFps = () => {
      const { activeViewportId } = viewportGridService.getState();
      const rate = cineService.getState?.()?.cines?.[activeViewportId]?.frameRate;
      if (Number.isFinite(rate) && rate > 0) {
        setSelectedFps(Math.round(rate));
      }
    };
    syncFps();
    const sub = cineService.subscribe?.(cineService.EVENTS.CINE_STATE_CHANGED, syncFps);
    const timer = window.setInterval(syncFps, 1000);
    return () => {
      sub?.unsubscribe?.();
      window.clearInterval(timer);
    };
  }, [isMobileLayout, servicesManager]);

  const applyFps = (fps: number) => {
    const next = Math.max(FPS_MIN, Math.min(FPS_MAX, Math.round(fps)));
    const { cineService, viewportGridService } = servicesManager.services;
    const { activeViewportId } = viewportGridService.getState();
    if (!activeViewportId) {
      return;
    }
    cineService.setCine?.({ id: activeViewportId, frameRate: next });
    setSelectedFps(next);
  };

  const bumpFps = (delta: number) => {
    applyFps((selectedFps || 25) + delta);
  };

  const runImageCommand = (command: string) => {
    try {
      commandsManager.run(command);
    } catch {
      try {
        commandsManager.runCommand(command);
      } catch {
        /* ignore */
      }
    }
  };

  /** Run the currently selected image tool (primary tap — does not open menu). */
  const runSelectedImageTool = () => {
    const tool = IMAGE_TOOLS.find(t => t.id === selectedImageTool) || IMAGE_TOOLS[0];
    runImageCommand(tool.command);
  };

  /** Pick a different tool from the menu, select it, and run it once. */
  const selectAndRunImageTool = (toolId: string, command: string) => {
    setSelectedImageTool(toolId);
    runImageCommand(command);
  };

  const SelectedImageIcon =
    IMAGE_TOOLS.find(t => t.id === selectedImageTool)?.Icon || Icons.ToolRotateRight;
  const selectedImageLabel =
    IMAGE_TOOLS.find(t => t.id === selectedImageTool)?.label || 'Rotate';

  const mobileNavBtn =
    'ohif-mobile-nav-btn h-9 w-9 shrink-0 text-white hover:bg-primary-active';

  const mobileLayoutMenu = isMobileLayout ? (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={mobileNavBtn}
          aria-label="Layout"
          data-cy="mobile-layout-menu"
        >
          <Icons.ToolLayout className="h-5 w-5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[10rem]">
        <DropdownMenuLabel>Layout</DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => setMobileLayoutGrid(1, 1)}>1 × 1</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setMobileLayoutGrid(1, 2)}>1 × 2</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setMobileLayoutGrid(2, 1)}>2 × 1</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setMobileLayoutGrid(2, 2)}>2 × 2</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  ) : null;

  // Compact − FPS + stepper
  const mobileFpsStepper = isMobileLayout ? (
    <div
      className="ohif-mobile-fps-stepper inline-flex h-9 items-center rounded-md bg-black/25"
      data-cy="mobile-fps-stepper"
    >
      <button
        type="button"
        className="flex h-9 w-7 items-center justify-center text-sm font-bold text-white"
        aria-label="Decrease FPS"
        onClick={() => bumpFps(-1)}
      >
        −
      </button>
      <span className="min-w-[1.5rem] text-center text-[11px] font-semibold tabular-nums text-white">
        {selectedFps}
      </span>
      <button
        type="button"
        className="flex h-9 w-7 items-center justify-center text-sm font-bold text-white"
        aria-label="Increase FPS"
        onClick={() => bumpFps(1)}
      >
        +
      </button>
    </div>
  ) : null;

  // Split: tap icon = run tool; chevron = pick another
  const mobileImageToolsControl = isMobileLayout ? (
    <div
      className="ohif-mobile-image-tool-split inline-flex h-9 items-stretch overflow-hidden rounded-md bg-primary-active/50"
      data-cy="mobile-image-tools"
    >
      <button
        type="button"
        className="flex h-9 w-9 items-center justify-center text-white"
        aria-label={`Use ${selectedImageLabel}`}
        title={`Tap to ${selectedImageLabel}`}
        onClick={runSelectedImageTool}
      >
        <SelectedImageIcon className="h-5 w-5" />
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="flex h-9 w-6 items-center justify-center border-l border-white/20 text-white"
            aria-label="Choose image tool"
            data-cy="mobile-image-tools-menu"
          >
            <Icons.ChevronClosed className="h-3 w-3" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[11rem]">
          <DropdownMenuLabel>Image tools</DropdownMenuLabel>
          {IMAGE_TOOLS.map(tool => {
            const isSelected = selectedImageTool === tool.id;
            const Icon = tool.Icon;
            return (
              <DropdownMenuItem
                key={tool.id}
                onSelect={() => selectAndRunImageTool(tool.id, tool.command)}
                className={`flex items-center gap-2 ${isSelected ? 'bg-primary/30 font-semibold' : ''}`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="flex-1">{tool.label}</span>
                {isSelected ? <span aria-hidden>✓</span> : null}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  ) : null;

  // Mobile sequence: Series → Tools | Layout | Image | −FPS+
  const mobileHeaderActions = isMobileLayout ? (
    <div
      className="ohif-mobile-nav-actions"
      data-cy="mobile-nav-actions"
    >
      {hasLeftPanels ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          data-cy="mobile-toggle-left-panel"
          aria-label="Series"
          aria-pressed={leftPanelOpen}
          className={`${mobileNavBtn} ${leftPanelOpen ? 'is-active' : ''}`}
          onClick={onToggleLeftPanel}
        >
          <Icons.ThumbnailView className="h-5 w-5" />
        </Button>
      ) : null}
      {hasRightPanels ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          data-cy="mobile-toggle-right-panel"
          aria-label="Tools"
          aria-pressed={rightPanelOpen}
          className={`${mobileNavBtn} ${rightPanelOpen ? 'is-active' : ''}`}
          onClick={onToggleRightPanel}
        >
          <Icons.Clipboard className="h-5 w-5" />
        </Button>
      ) : null}
      {(hasLeftPanels || hasRightPanels) && (mobileLayoutMenu || mobileImageToolsControl || mobileFpsStepper) ? (
        <span className="ohif-mobile-nav-divider" aria-hidden />
      ) : null}
      {mobileLayoutMenu}
      {mobileImageToolsControl}
      {mobileFpsStepper}
    </div>
  ) : null;

  return (
    <Header
      menuOptions={menuOptions}
      isReturnEnabled={!!appConfig.showStudyList}
      onClickReturnButton={onClickReturnButton}
      WhiteLabeling={appConfig.whiteLabeling}
      reportNavigationHref={isIframeMode || isMobileLayout ? undefined : reportNavigationHref}
      onReportNavigation={isMobileLayout ? undefined : onReportNavigation}
      Secondary={null}
      isIframeMode={isIframeMode}
      isMobileLayout={isMobileLayout}
      HeaderActions={mobileHeaderActions}
      UndoRedo={
        isMobileLayout ? null : (
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
        )
      }
    >
      {isMobileLayout ? null : (
        <div
          className={`ohif-header-toolbar relative flex w-full justify-center overflow-x-auto overflow-y-hidden ${isIframeMode ? 'ohif-header-toolbar--iframe iframe-toolbar-compact' : ''}`}
        >
          <div className="flex w-full items-center justify-center gap-2 whitespace-nowrap">
            <Toolbar
              buttonSection="primary"
              grouped
            />
          </div>
        </div>
      )}
    </Header>
  );
}

export default ViewerHeader;
