import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icons, Button, useCine } from '@ohif/ui-next';
import { advanceUsBatch, buildUsBatchNavigationInfo } from '../../utils/usBatchNavigationUtils';
import {
  pauseAllUsViewports,
  playAllUsViewports,
  stopAllUsViewports,
} from '../../utils/usCinePlaybackUtils';
import { getUsCineCapableLayoutViewportIds } from '../../utils/usGridViewportUtils';
import { activeTransportClass } from './usCineUiUtils';

const VIEWPORT_GRID_CONTAINER_SELECTOR = '[data-cy="viewport-grid-container"]';

type PageInfo = {
  currentPage: number;
  totalPages: number;
  hasNextBatch: boolean;
  hasPrevBatch: boolean;
};

type UsStudyCineHeaderProps = {
  servicesManager: AppTypes.ServicesManager;
  onPageChange?: () => void;
};

function UsStudyCineHeader({ servicesManager, onPageChange }: UsStudyCineHeaderProps) {
  const [gridContainer, setGridContainer] = useState<HTMLElement | null>(null);
  const [pageInfo, setPageInfo] = useState<PageInfo | null>(null);
  const [{ cines }] = useCine();

  const isAnyPlaying = useMemo(() => {
    const viewportIds = getUsCineCapableLayoutViewportIds(servicesManager);
    return viewportIds.some(id => cines?.[id]?.isPlaying);
  }, [cines, servicesManager]);

  const refreshPageInfo = useCallback(() => {
    const batchInfo = buildUsBatchNavigationInfo(servicesManager);

    if (batchInfo?.mode === 'instances') {
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
    setGridContainer(
      document.querySelector(VIEWPORT_GRID_CONTAINER_SELECTOR) as HTMLElement | null
    );
  }, []);

  useEffect(() => {
    const { viewportGridService, displaySetService, cineService } = servicesManager.services;

    const refresh = () => refreshPageInfo();

    const gridSub = viewportGridService.subscribe(
      viewportGridService.EVENTS.GRID_STATE_CHANGED,
      refresh
    );
    const dsSub = displaySetService.subscribe(
      displaySetService.EVENTS.DISPLAY_SETS_CHANGED,
      refresh
    );
    const cineSub = cineService.subscribe(cineService.EVENTS.CINE_STATE_CHANGED, refresh);

    refresh();

    return () => {
      gridSub.unsubscribe();
      dsSub.unsubscribe();
      cineSub.unsubscribe();
    };
  }, [refreshPageInfo, servicesManager]);

  if (!pageInfo) {
    return null;
  }

  const handleRetreat = () => {
    advanceUsBatch(servicesManager, -1);
    onPageChange?.();
    window.setTimeout(refreshPageInfo, 400);
  };

  const handleAdvance = () => {
    advanceUsBatch(servicesManager, 1);
    onPageChange?.();
    window.setTimeout(refreshPageInfo, 400);
  };

  const handlePlayAll = () => {
    playAllUsViewports(servicesManager);
  };

  const navBtnClass =
    'h-5 w-5 shrink-0 p-0 text-white/90 hover:bg-white/15 disabled:opacity-30 [&_svg]:h-3 [&_svg]:w-3';
  const transportBtnClass = 'h-5 w-5 shrink-0 p-0 transition-colors [&_svg]:h-3 [&_svg]:w-3';

  const header = (
    <div
      className="pointer-events-auto inline-flex items-center gap-1.5 rounded border border-white/20 bg-black/75 px-1.5 py-0.5 text-[10px] text-white shadow-sm backdrop-blur-sm"
      data-cy="us-study-cine-header"
    >
      <div className="inline-flex items-center">
        <Button
          variant="ghost"
          size="icon"
          className={navBtnClass}
          onClick={handleRetreat}
          disabled={!pageInfo.hasPrevBatch}
          title="Previous page"
          data-cy="us-series-page-prev"
        >
          <Icons.ChevronLeft />
        </Button>
        <span
          className="min-w-[2rem] px-0.5 text-center text-[11px] font-semibold leading-none tabular-nums"
          data-cy="us-series-page-label"
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
          data-cy="us-series-page-next"
        >
          <Icons.ChevronRight />
        </Button>
      </div>

      <span className="h-3 w-px bg-white/25" aria-hidden />

      <div className="inline-flex items-center gap-0.5">
        <Button
          variant="ghost"
          size="icon"
          className={`${transportBtnClass} rounded-sm ${isAnyPlaying ? activeTransportClass(true) : 'text-white/90 hover:bg-white/10'}`}
          onClick={() => {
            if (isAnyPlaying) {
              pauseAllUsViewports(servicesManager);
            } else {
              handlePlayAll();
            }
          }}
          title={isAnyPlaying ? 'Pause all' : 'Play all'}
          data-cy="us-play-pause-all"
        >
          <Icons.ByName name={isAnyPlaying ? 'icon-pause' : 'icon-play'} />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className={`${transportBtnClass} rounded-sm text-white/80 hover:bg-white/15`}
          onClick={() => {
            stopAllUsViewports(servicesManager);
            onPageChange?.();
          }}
          title="Stop all"
          data-cy="us-stop-all"
        >
          <span className="inline-block h-2 w-2 rounded-[1px] bg-current" />
        </Button>
      </div>
    </div>
  );

  if (!gridContainer) {
    return null;
  }

  return createPortal(
    <div className="pointer-events-none absolute top-1 left-1/2 z-[60] -translate-x-1/2">
      {header}
    </div>,
    gridContainer
  );
}

export default UsStudyCineHeader;
