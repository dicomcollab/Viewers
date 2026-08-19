import React, { useCallback, useEffect, useState } from 'react';
import { Icons, Button } from '@ohif/ui-next';
import { advanceUsBatch, buildUsBatchNavigationInfo } from '../../utils/usBatchNavigationUtils';
import { isUsFrameDistributionEnabled } from '@ohif/extension-default';

type PageInfo = {
  currentPage: number;
  totalPages: number;
  hasNextBatch: boolean;
  hasPrevBatch: boolean;
  mode?: 'instances' | 'frames';
};

type StudyCineHeaderControlsProps = {
  servicesManager: AppTypes.ServicesManager;
};

function StudyCineHeaderControls({ servicesManager }: StudyCineHeaderControlsProps) {
  const [pageInfo, setPageInfo] = useState<PageInfo | null>(null);

  const refreshPageInfo = useCallback(() => {
    const batchInfo = buildUsBatchNavigationInfo(servicesManager);

    const shouldShowPager =
      batchInfo?.mode === 'instances' ||
      (batchInfo?.mode === 'frames' && isUsFrameDistributionEnabled());

    if (shouldShowPager) {
      setPageInfo({
        currentPage: batchInfo.currentPage,
        totalPages: batchInfo.totalPages,
        hasNextBatch: batchInfo.hasNextBatch,
        hasPrevBatch: batchInfo.hasPrevBatch,
        mode: batchInfo.mode,
      });
      return;
    }

    setPageInfo(null);
  }, [servicesManager]);

  useEffect(() => {
    const { viewportGridService, displaySetService } = servicesManager.services! as any;

    const refresh = () => refreshPageInfo();

    const gridSub = viewportGridService.subscribe(
      viewportGridService.EVENTS.GRID_STATE_CHANGED,
      refresh
    );
    const dsSub = displaySetService.subscribe(
      displaySetService.EVENTS.DISPLAY_SETS_CHANGED,
      refresh
    );

    refresh();

    return () => {
      gridSub.unsubscribe();
      dsSub.unsubscribe();
    };
  }, [refreshPageInfo, servicesManager]);

  if (!pageInfo || pageInfo.totalPages <= 1) {
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
  const isFrameGroupNav = pageInfo.mode === 'frames';
  const prevTitle = isFrameGroupNav ? 'Previous group' : 'Previous page';
  const nextTitle = isFrameGroupNav ? 'Next group' : 'Next page';

  return (
    <div
      className="border-white/15 inline-flex h-7 items-center gap-0.5 rounded border bg-[#00000080] px-0.5"
      data-cy="study-cine-header-controls"
    >
      <div className="inline-flex items-center gap-px">
        <Button
          variant="ghost"
          size="icon"
          className={navBtnClass}
          onClick={handleRetreat}
          disabled={!pageInfo.hasPrevBatch}
          title={prevTitle}
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
          title={nextTitle}
          data-cy="study-series-page-next"
        >
          <Icons.ChevronRight />
        </Button>
      </div>
    </div>
  );
}

export default StudyCineHeaderControls;
