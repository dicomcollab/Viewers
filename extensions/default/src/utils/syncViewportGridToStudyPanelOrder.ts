import { utils } from '@ohif/core';
import {
  getStudyPanelNavigationOrder,
  subscribeStudyPanelNavigationOrder,
} from './studyPanelNavigationOrder';

const { compareDisplaySetsByReviewOrder } = utils;

const NON_IMAGE_MODALITIES = new Set([
  'SR',
  'SEG',
  'RTSTRUCT',
  'RTPLAN',
  'RTDOSE',
  'DOC',
  'PMAP',
  'PR',
  'KO',
]);

/**
 * Display sets that can fill a stack viewport, in Study Panel visual order.
 * Skips unsupported / non-image rows so 2×2 matches what the user sees
 * (e.g. Topogram, Rest, Stress, PET Dose — not Corridor jumping ahead of Stress).
 */
function buildFallbackStudyPanelOrder(activeDisplaySets: any[]): any[] {
  const sorted = [...(activeDisplaySets || [])]
    .filter(ds => ds && !ds.excludeFromThumbnailBrowser)
    .sort(compareDisplaySetsByReviewOrder);

  const isReport = (ds: any) => NON_IMAGE_MODALITIES.has(String(ds?.Modality || '').toUpperCase());
  const isNoImage = (ds: any) => isReport(ds) || Boolean(ds?.unsupported);

  return [
    ...sorted.filter(ds => !isNoImage(ds)),
    ...sorted.filter(ds => isNoImage(ds) && !isReport(ds)),
    ...sorted.filter(ds => isReport(ds)),
  ];
}

function isHangableForStackViewport(ds: any): boolean {
  if (!ds || ds.excludeFromThumbnailBrowser || ds.unsupported) {
    return false;
  }

  const modality = String(ds.Modality || '').toUpperCase();

  // US + SR study slots page together (match US batch navigation).
  if (modality === 'SR') {
    return true;
  }
  if (modality === 'US' && (ds.numImageFrames ?? 0) >= 1) {
    return true;
  }

  if (NON_IMAGE_MODALITIES.has(modality)) {
    return false;
  }

  const frames = ds.numImageFrames ?? ds.instances?.length ?? ds.imageIds?.length ?? 0;
  if (frames > 0) {
    return true;
  }

  return Array.isArray(ds.images) && ds.images.length > 0;
}

function getDisplaySetsInStudyPanelOrder(displaySetService): any[] {
  const panelOrderUIDs = getStudyPanelNavigationOrder();
  let ordered =
    panelOrderUIDs.length > 0
      ? panelOrderUIDs
          .map(uid => {
            try {
              return displaySetService.getDisplaySetByUID(uid);
            } catch {
              return null;
            }
          })
          .filter(Boolean)
      : [];

  if (!ordered.length) {
    ordered = buildFallbackStudyPanelOrder(displaySetService.activeDisplaySets || []);
  }

  return ordered.filter(isHangableForStackViewport);
}

function getLayoutViewportIdsSorted(viewportGridService): string[] {
  const { viewports } = viewportGridService.getState();

  return Array.from(viewports.entries())
    .sort(([, a], [, b]) => {
      const rowDiff = (a.y ?? 0) - (b.y ?? 0);
      if (rowDiff !== 0) {
        return rowDiff;
      }
      return (a.x ?? 0) - (b.x ?? 0);
    })
    .map(([viewportId]) => viewportId);
}

/**
 * Re-assign multi-viewport layouts so tile order matches the Study Panel
 * (row-major: 1 2 / 3 4). No-op for 1×1 or when already aligned.
 */
function syncViewportGridToStudyPanelOrder(servicesManager: AppTypes.ServicesManager): boolean {
  const { displaySetService, viewportGridService } = servicesManager.services || {};
  if (!displaySetService || !viewportGridService) {
    return false;
  }

  const layoutViewportIds = getLayoutViewportIdsSorted(viewportGridService);
  if (layoutViewportIds.length <= 1) {
    return false;
  }

  const hangableInPanelOrder = getDisplaySetsInStudyPanelOrder(displaySetService);
  if (!hangableInPanelOrder.length) {
    return false;
  }

  const { viewports } = viewportGridService.getState();

  // Keep the current "page" when the study has more series than tiles (US paging).
  const hungIndices = layoutViewportIds
    .map(viewportId => {
      const uids = viewports.get(viewportId)?.displaySetInstanceUIDs || [];
      const uid = uids[0];
      if (!uid) {
        return -1;
      }
      return hangableInPanelOrder.findIndex(ds => ds.displaySetInstanceUID === uid);
    })
    .filter(index => index >= 0);

  const batchStart = hungIndices.length ? Math.min(...hungIndices) : 0;
  const pageStart =
    hangableInPanelOrder.length > layoutViewportIds.length
      ? Math.floor(batchStart / layoutViewportIds.length) * layoutViewportIds.length
      : 0;

  const needsSync = layoutViewportIds.some((viewportId, index) => {
    const expected = hangableInPanelOrder[pageStart + index];
    const actualUid = viewports.get(viewportId)?.displaySetInstanceUIDs?.[0];

    if (!expected) {
      return Boolean(actualUid);
    }

    return actualUid !== expected.displaySetInstanceUID;
  });

  if (!needsSync) {
    return false;
  }

  const viewportsToUpdate = layoutViewportIds.map((viewportId, index) => {
    const expected = hangableInPanelOrder[pageStart + index];
    return {
      viewportId,
      displaySetInstanceUIDs: expected ? [expected.displaySetInstanceUID] : [],
    };
  });

  viewportGridService.setDisplaySetsForViewports(viewportsToUpdate);
  return true;
}

/**
 * Keep viewports aligned whenever the Study Panel publishes a new thumbnail order.
 */
function initStudyPanelViewportOrderSync(servicesManager: AppTypes.ServicesManager): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;

  const schedule = () => {
    if (timer) {
      window.clearTimeout(timer);
    }
    timer = window.setTimeout(() => {
      timer = null;
      syncViewportGridToStudyPanelOrder(servicesManager);
    }, 100);
  };

  const unsubscribeOrder = subscribeStudyPanelNavigationOrder(schedule);
  const { hangingProtocolService } = servicesManager.services || {};

  const hpSub = hangingProtocolService?.subscribe?.(
    hangingProtocolService.EVENTS.PROTOCOL_CHANGED,
    schedule
  );

  return () => {
    if (timer) {
      window.clearTimeout(timer);
    }
    unsubscribeOrder?.();
    hpSub?.unsubscribe?.();
  };
}

export {
  getDisplaySetsInStudyPanelOrder,
  initStudyPanelViewportOrderSync,
  syncViewportGridToStudyPanelOrder,
};
