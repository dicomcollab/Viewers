import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  getActiveDisplaySetUID,
  getMobileImageDisplaySets,
  selectDisplaySetInActiveViewport,
} from './mobileDisplaySetUtils';
import { useMobileThumbnailLoader } from './mobileThumbnailUtils';
import './MobileSeriesSheet.css';

type MobileSeriesSheetProps = {
  servicesManager: AppTypes.ServicesManager;
  commandsManager: AppTypes.CommandsManager;
  onClose?: () => void;
};

/**
 * Mobile-native series grid (3 columns) with real thumbnails.
 */
function MobileSeriesSheet({
  servicesManager,
  commandsManager,
  onClose,
}: MobileSeriesSheetProps) {
  const { displaySetService, viewportGridService } = servicesManager.services;
  const { loadThumbnail } = useMobileThumbnailLoader();
  const [items, setItems] = useState(() => getMobileImageDisplaySets(displaySetService));
  const [activeUid, setActiveUid] = useState(() => getActiveDisplaySetUID(viewportGridService));
  const [thumbMap, setThumbMap] = useState<Record<string, string>>({});
  const loadingRef = useRef<Set<string>>(new Set());
  const loadedRef = useRef<Set<string>>(new Set());

  const sync = useCallback(() => {
    setItems(getMobileImageDisplaySets(displaySetService));
    setActiveUid(getActiveDisplaySetUID(viewportGridService));
  }, [displaySetService, viewportGridService]);

  useEffect(() => {
    sync();
    const subs = [
      displaySetService.subscribe?.(displaySetService.EVENTS.DISPLAY_SETS_CHANGED, sync),
      displaySetService.subscribe?.(displaySetService.EVENTS.DISPLAY_SETS_ADDED, sync),
      viewportGridService.subscribe?.(viewportGridService.EVENTS.GRID_STATE_CHANGED, sync),
      viewportGridService.subscribe?.(viewportGridService.EVENTS.ACTIVE_VIEWPORT_ID_CHANGED, sync),
      viewportGridService.subscribe?.(viewportGridService.EVENTS.VIEWPORTS_READY, sync),
    ].filter(Boolean);
    return () => subs.forEach(s => s?.unsubscribe?.());
  }, [displaySetService, viewportGridService, sync]);

  // Load missing thumbnails (same pipeline as desktop Study Browser).
  useEffect(() => {
    let cancelled = false;
    const pending = new Set<string>();

    const run = async () => {
      const jobs = items.map(async ds => {
        const uid = ds.displaySetInstanceUID;
        if (!uid) {
          return;
        }
        if (ds.thumbnailSrc || loadedRef.current.has(uid)) {
          if (ds.thumbnailSrc && !loadedRef.current.has(uid)) {
            loadedRef.current.add(uid);
            if (!cancelled) {
              setThumbMap(prev => (prev[uid] ? prev : { ...prev, [uid]: ds.thumbnailSrc }));
            }
          }
          return;
        }
        if (loadingRef.current.has(uid)) {
          return;
        }
        loadingRef.current.add(uid);
        pending.add(uid);
        try {
          const src = await loadThumbnail(ds);
          if (cancelled) {
            return;
          }
          if (src) {
            loadedRef.current.add(uid);
            setThumbMap(prev => ({ ...prev, [uid]: src }));
          } else {
            // Allow a later retry if imageIds were not ready yet.
            loadingRef.current.delete(uid);
          }
        } catch {
          loadingRef.current.delete(uid);
        } finally {
          pending.delete(uid);
        }
      });
      await Promise.allSettled(jobs);
    };
    void run();
    return () => {
      cancelled = true;
      // Unlock in-flight UIDs so the next effect can retry.
      pending.forEach(uid => loadingRef.current.delete(uid));
    };
  }, [items, loadThumbnail]);

  const onSelect = (uid: string) => {
    selectDisplaySetInActiveViewport({
      commandsManager,
      viewportGridService,
      displaySetInstanceUID: uid,
    });
    setActiveUid(uid);
    onClose?.();
  };

  if (!items.length) {
    return (
      <div className="ohif-mobile-series-sheet__empty">No image series in this study.</div>
    );
  }

  return (
    <div
      className="ohif-mobile-series-sheet"
      data-cy="mobile-series-sheet"
    >
      <div className="ohif-mobile-series-sheet__grid">
        {items.map((ds, index) => {
          const uid = ds.displaySetInstanceUID;
          const active = uid === activeUid;
          const src = thumbMap[uid] || ds.thumbnailSrc || ds.imageSrc;
          const label =
            ds.SeriesDescription || ds.Modality || `Series ${ds.SeriesNumber ?? index + 1}`;
          const count = ds.numImageFrames || ds.images?.length || ds.instances?.length || 1;
          return (
            <button
              key={uid}
              type="button"
              className={`ohif-mobile-series-sheet__card ${active ? 'is-active' : ''}`}
              onClick={() => onSelect(uid)}
            >
              <div className="ohif-mobile-series-sheet__thumb">
                {src ? (
                  <img
                    src={src}
                    alt=""
                    draggable={false}
                  />
                ) : (
                  <span className="ohif-mobile-series-sheet__modality">{ds.Modality}</span>
                )}
                <span className="ohif-mobile-series-sheet__badge">
                  S:{ds.SeriesNumber ?? index + 1} · {count}
                </span>
              </div>
              <div className="ohif-mobile-series-sheet__caption">{label}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default MobileSeriesSheet;
