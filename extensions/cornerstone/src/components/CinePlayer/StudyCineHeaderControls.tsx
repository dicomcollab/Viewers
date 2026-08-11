import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Icons, Button, useCine } from '@ohif/ui-next';
import { advanceUsBatch, buildUsBatchNavigationInfo } from '../../utils/usBatchNavigationUtils';
import {
  applyCineSettingsToAllViewports,
  pauseAllUsViewports,
  playAllUsViewports,
} from '../../utils/usCinePlaybackUtils';
import {
  getCineCapableViewportIds,
  shouldShowStudyCineHeaderControls,
} from '../../utils/cineSyncUtils';
import { getCinePreferences } from '../../utils/cinePreferencesUtils';
import { DEFAULT_US_FRAME_STEP, US_CINE_DEFAULT_FPS } from '../../utils/usStackCineUtils';
import { activeTransportClass, type CinePlayMode } from './usCineUiUtils';
import CineFpsFrControls from './CineFpsFrControls';

type PageInfo = {
  currentPage: number;
  totalPages: number;
  hasNextBatch: boolean;
  hasPrevBatch: boolean;
};

type StudyCineHeaderControlsProps = {
  servicesManager: AppTypes.ServicesManager;
};

function StudyCineHeaderControls({ servicesManager }: StudyCineHeaderControlsProps) {
  const [pageInfo, setPageInfo] = useState<PageInfo | null>(null);
  const [{ cines }] = useCine();
  const [showControls, setShowControls] = useState(() =>
    shouldShowStudyCineHeaderControls(servicesManager)
  );
  const [activeViewportId, setActiveViewportId] = useState(
    () => servicesManager.services.viewportGridService.getState().activeViewportId
  );

  const cineCapableViewportIds = getCineCapableViewportIds(servicesManager);

  const referenceViewportId =
    activeViewportId && cineCapableViewportIds.includes(activeViewportId)
      ? activeViewportId
      : (cineCapableViewportIds[0] ?? null);

  const referenceCine = referenceViewportId ? cines?.[referenceViewportId] : null;
  const frameRate = referenceCine?.frameRate ?? US_CINE_DEFAULT_FPS;
  const frameStep = referenceCine?.frameStep ?? DEFAULT_US_FRAME_STEP;
  const cinePlayMode = (referenceCine?.cinePlayMode ?? 'fps') as CinePlayMode;
  const cinePreferences = useMemo(() => getCinePreferences(), []);

  const isAnyPlaying = useMemo(() => {
    return cineCapableViewportIds.some(id => cines?.[id]?.isPlaying);
  }, [cineCapableViewportIds, cines]);

  const refreshPageInfo = useCallback(() => {
    setShowControls(shouldShowStudyCineHeaderControls(servicesManager));

    const batchInfo = buildUsBatchNavigationInfo(servicesManager);

    if (batchInfo?.mode === 'instances' || batchInfo?.mode === 'frames') {
      setPageInfo({
        currentPage: batchInfo.currentPage,
        totalPages: batchInfo.totalPages,
        hasNextBatch: batchInfo.hasNextBatch,
        hasPrevBatch: batchInfo.hasPrevBatch,
      });
      return;
    }

    setPageInfo(null);
  }, [servicesManager]);

  useEffect(() => {
    const { viewportGridService, displaySetService, cineService } = servicesManager.services;

    const refresh = () => refreshPageInfo();

    const gridSub = viewportGridService.subscribe(
      viewportGridService.EVENTS.GRID_STATE_CHANGED,
      refresh
    );
    const activeViewportSub = viewportGridService.subscribe(
      viewportGridService.EVENTS.ACTIVE_VIEWPORT_ID_CHANGED,
      ({ viewportId }) => setActiveViewportId(viewportId)
    );
    const dsSub = displaySetService.subscribe(
      displaySetService.EVENTS.DISPLAY_SETS_CHANGED,
      refresh
    );
    const cineSub = cineService.subscribe(cineService.EVENTS.CINE_STATE_CHANGED, refresh);

    refresh();

    return () => {
      gridSub.unsubscribe();
      activeViewportSub.unsubscribe();
      dsSub.unsubscribe();
      cineSub.unsubscribe();
    };
  }, [refreshPageInfo, servicesManager]);

  if (!showControls || !cineCapableViewportIds.length) {
    return null;
  }

  const handleRetreat = () => {
    advanceUsBatch(servicesManager, -1);
    window.setTimeout(refreshPageInfo, 400);
  };

  const handleAdvance = () => {
    advanceUsBatch(servicesManager, 1);
    window.setTimeout(refreshPageInfo, 400);
  };

  const navBtnClass =
    'h-6 w-6 shrink-0 p-0 text-white hover:bg-primary-active disabled:opacity-30 [&_svg]:h-3 [&_svg]:w-3';
  const transportBtnClass = 'h-6 w-6 shrink-0 p-0 transition-colors [&_svg]:h-3 [&_svg]:w-3';

  return (
    <div
      className="border-white/15 inline-flex h-7 items-center gap-0.5 rounded border bg-[#00000080] px-0.5"
      data-cy="study-cine-header-controls"
    >
      {pageInfo && pageInfo.totalPages > 1 ? (
        <>
          <div className="inline-flex items-center gap-px">
            <Button
              variant="ghost"
              size="icon"
              className={navBtnClass}
              onClick={handleRetreat}
              disabled={!pageInfo.hasPrevBatch}
              title="Previous page"
              data-cy="study-series-page-prev"
            >
              <Icons.ChevronLeft />
            </Button>
            <span
              className="min-w-[1.75rem] px-px text-center text-[10px] font-semibold tabular-nums leading-none text-white"
              data-cy="study-series-page-label"
            >
              {pageInfo.currentPage}/{pageInfo.totalPages}
            </span>
            <Button
              variant="ghost"
              size="icon"
              className={navBtnClass}
              onClick={handleAdvance}
              disabled={!pageInfo.hasNextBatch}
              title="Next page"
              data-cy="study-series-page-next"
            >
              <Icons.ChevronRight />
            </Button>
          </div>
          <span
            className="mx-px h-3.5 w-px bg-white/25"
            aria-hidden
          />
        </>
      ) : null}

      <Button
        variant="ghost"
        size="icon"
        className={`${transportBtnClass} rounded-sm ${isAnyPlaying ? activeTransportClass(true) : 'hover:bg-primary-active text-white'}`}
        onClick={() => {
          if (isAnyPlaying) {
            pauseAllUsViewports(servicesManager);
          } else {
            playAllUsViewports(servicesManager);
          }
        }}
        title={isAnyPlaying ? 'Pause all' : 'Play all'}
        data-cy="study-play-pause-all"
      >
        <Icons.ByName name={isAnyPlaying ? 'icon-pause' : 'icon-play'} />
      </Button>

      {cinePreferences.showFps || cinePreferences.showFr ? (
        <>
          <span
            className="mx-px h-3.5 w-px bg-white/25"
            aria-hidden
          />
          <CineFpsFrControls
            frameRate={frameRate}
            frameStep={frameStep}
            cinePlayMode={cinePlayMode}
            showFps={cinePreferences.showFps}
            showFr={cinePreferences.showFr}
            onFrameRateChange={nextFrameRate =>
              applyCineSettingsToAllViewports(servicesManager, {
                frameRate: nextFrameRate,
                cinePlayMode: 'fps',
              })
            }
            onFrameStepChange={nextFrameStep =>
              applyCineSettingsToAllViewports(servicesManager, {
                frameStep: nextFrameStep,
                cinePlayMode: 'step',
              })
            }
            onPlayModeChange={mode =>
              applyCineSettingsToAllViewports(servicesManager, { cinePlayMode: mode })
            }
          />
        </>
      ) : null}
    </div>
  );
}

export default StudyCineHeaderControls;
