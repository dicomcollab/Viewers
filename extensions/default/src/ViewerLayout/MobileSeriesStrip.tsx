import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  getActiveDisplaySetUID,
  getMobileImageDisplaySets,
  selectDisplaySetInActiveViewport,
} from './mobileDisplaySetUtils';
import { useMobileThumbnailLoader } from './mobileThumbnailUtils';
import './MobileSeriesStrip.css';

type MobileSeriesStripProps = {
  servicesManager: AppTypes.ServicesManager;
  commandsManager: AppTypes.CommandsManager;
  onExpandSeriesSheet?: () => void;
};

/**
 * Horizontal series thumbnail strip for mobile portrait chrome.
 */
function MobileSeriesStrip({
  servicesManager,
  commandsManager,
  onExpandSeriesSheet,
}: MobileSeriesStripProps) {
  const { displaySetService, viewportGridService } = servicesManager.services;
  const { loadThumbnail } = useMobileThumbnailLoader();
  const [displaySets, setDisplaySets] = useState(() =>
    getMobileImageDisplaySets(displaySetService)
  );
  const [activeUid, setActiveUid] = useState<string | null>(() =>
    getActiveDisplaySetUID(viewportGridService)
  );
  const [thumbMap, setThumbMap] = useState<Record<string, string>>({});
  const loadingRef = useRef<Set<string>>(new Set());
  const loadedRef = useRef<Set<string>>(new Set());
  const listRef = useRef<HTMLDivElement>(null);
  const touchStartY = useRef<number | null>(null);

  const sync = useCallback(() => {
    setDisplaySets(getMobileImageDisplaySets(displaySetService));
    setActiveUid(getActiveDisplaySetUID(viewportGridService));
  }, [displaySetService, viewportGridService]);

  useEffect(() => {
    sync();
    const subs = [
      displaySetService.subscribe?.(displaySetService.EVENTS.DISPLAY_SETS_CHANGED, sync),
      displaySetService.subscribe?.(displaySetService.EVENTS.DISPLAY_SETS_ADDED, sync),
      viewportGridService.subscribe?.(viewportGridService.EVENTS.ACTIVE_VIEWPORT_ID_CHANGED, sync),
      viewportGridService.subscribe?.(viewportGridService.EVENTS.GRID_STATE_CHANGED, sync),
      viewportGridService.subscribe?.(viewportGridService.EVENTS.VIEWPORTS_READY, sync),
    ].filter(Boolean);
    return () => subs.forEach(s => s?.unsubscribe?.());
  }, [displaySetService, viewportGridService, sync]);

  useEffect(() => {
    let cancelled = false;
    const pending = new Set<string>();

    const run = async () => {
      const jobs = displaySets.map(async ds => {
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
      pending.forEach(uid => loadingRef.current.delete(uid));
    };
  }, [displaySets, loadThumbnail]);

  useEffect(() => {
    if (!activeUid || !listRef.current) {
      return;
    }
    const el = listRef.current.querySelector(`#mobile-thumb-${activeUid}`) as HTMLElement | null;
    el?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }, [activeUid]);

  const onSelect = useCallback(
    (displaySetInstanceUID: string) => {
      selectDisplaySetInActiveViewport({
        commandsManager,
        viewportGridService,
        displaySetInstanceUID,
      });
      setActiveUid(displaySetInstanceUID);
    },
    [commandsManager, viewportGridService]
  );

  const items = useMemo(
    () =>
      displaySets.map((ds, index) => ({
        uid: ds.displaySetInstanceUID,
        label: ds.SeriesNumber ?? index + 1,
        modality: ds.Modality,
        src: thumbMap[ds.displaySetInstanceUID] || ds.thumbnailSrc || ds.imageSrc,
        isMMode: ds.Modality === 'US' && /m[\s-]?mode/i.test(ds.SeriesDescription || ''),
        description: ds.SeriesDescription || ds.Modality,
      })),
    [displaySets, thumbMap]
  );

  if (!items.length) {
    return null;
  }

  return (
    <div
      className="ohif-mobile-series-strip"
      data-cy="mobile-series-strip"
      onTouchStart={e => {
        touchStartY.current = e.touches[0]?.clientY ?? null;
      }}
      onTouchEnd={e => {
        if (touchStartY.current == null || !onExpandSeriesSheet) {
          return;
        }
        const endY = e.changedTouches[0]?.clientY;
        if (endY != null && touchStartY.current - endY > 40) {
          onExpandSeriesSheet();
        }
        touchStartY.current = null;
      }}
    >
      <button
        type="button"
        className="ohif-mobile-series-strip__expand"
        aria-label="Open series list"
        onClick={onExpandSeriesSheet}
      >
        ▢
      </button>
      <div
        className="ohif-mobile-series-strip__list scrollbar-hide"
        ref={listRef}
      >
        {items.map((item, index) => {
          const active = item.uid === activeUid;
          return (
            <button
              key={item.uid}
              id={`mobile-thumb-${item.uid}`}
              type="button"
              className={`ohif-mobile-series-strip__thumb ${active ? 'is-active' : ''}`}
              aria-label={`Series ${item.label}`}
              aria-pressed={active}
              title={item.description}
              onClick={() => onSelect(item.uid)}
            >
              {item.src ? (
                <img
                  src={item.src}
                  alt=""
                  draggable={false}
                />
              ) : (
                <span className="ohif-mobile-series-strip__fallback">{item.modality}</span>
              )}
              <span className="ohif-mobile-series-strip__badge">{item.label ?? index + 1}</span>
              {item.isMMode ? <span className="ohif-mobile-series-strip__m">M</span> : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default MobileSeriesStrip;
