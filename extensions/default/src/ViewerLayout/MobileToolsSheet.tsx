import React, { useCallback, useEffect, useState } from 'react';
import './MobileToolsSheet.css';

type TabId = 'keyImages' | 'measurements';

type MobileToolsSheetProps = {
  servicesManager: AppTypes.ServicesManager;
  commandsManager: AppTypes.CommandsManager;
  initialTab?: TabId;
  onClose?: () => void;
};

/**
 * Mobile-native Tools sheet: Key Images + Measurements tabs.
 * Replaces the desktop right SidePanel chrome inside the bottom sheet.
 */
function MobileToolsSheet({
  servicesManager,
  commandsManager,
  initialTab = 'keyImages',
  onClose,
}: MobileToolsSheetProps) {
  const { keyImagesService, measurementService, viewportGridService } =
    servicesManager.services;
  const [tab, setTab] = useState<TabId>(initialTab);
  const [keyImages, setKeyImages] = useState(() => keyImagesService?.getKeyImages?.() || []);
  const [measurements, setMeasurements] = useState(
    () => measurementService?.getMeasurements?.() || []
  );

  useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);

  const syncKeys = useCallback(() => {
    setKeyImages(keyImagesService?.getKeyImages?.() || []);
  }, [keyImagesService]);

  const syncMeasurements = useCallback(() => {
    setMeasurements(measurementService?.getMeasurements?.() || []);
  }, [measurementService]);

  useEffect(() => {
    syncKeys();
    const ev = keyImagesService?.EVENTS?.KEY_IMAGES_CHANGED;
    if (!keyImagesService?.subscribe || !ev) {
      return;
    }
    const sub = keyImagesService.subscribe(ev, syncKeys);
    return () => sub?.unsubscribe?.();
  }, [keyImagesService, syncKeys]);

  useEffect(() => {
    syncMeasurements();
    const events = [
      measurementService?.EVENTS?.MEASUREMENT_ADDED,
      measurementService?.EVENTS?.MEASUREMENT_UPDATED,
      measurementService?.EVENTS?.MEASUREMENT_REMOVED,
      measurementService?.EVENTS?.MEASUREMENTS_CLEARED,
    ].filter(Boolean);
    const subs = events.map(ev => measurementService.subscribe(ev, syncMeasurements));
    return () => subs.forEach(s => s?.unsubscribe?.());
  }, [measurementService, syncMeasurements]);

  const addKeyImage = () => {
    commandsManager.run('addKeyImage');
  };

  const jumpToMeasurement = (m: any) => {
    try {
      const uid = m?.displaySetInstanceUID || m?.referenceDisplaySetUID;
      const { activeViewportId } = viewportGridService.getState();
      if (uid && activeViewportId) {
        commandsManager.run('setDisplaySetsForViewports', {
          viewportsToUpdate: [
            {
              viewportId: activeViewportId,
              displaySetInstanceUIDs: [uid],
            },
          ],
        });
      }
      if (typeof m?.frameNumber === 'number' || typeof m?.imageIndex === 'number') {
        const imageIndex =
          typeof m.imageIndex === 'number'
            ? m.imageIndex
            : Math.max(0, (m.frameNumber || 1) - 1);
        commandsManager.run('jumpToImage', { imageIndex });
      }
      onClose?.();
    } catch {
      /* ignore */
    }
  };

  return (
    <div
      className="ohif-mobile-tools-sheet"
      data-cy="mobile-tools-sheet"
    >
      <div className="ohif-mobile-tools-sheet__tabs">
        <button
          type="button"
          className={tab === 'keyImages' ? 'is-active' : ''}
          onClick={() => setTab('keyImages')}
        >
          Key Images{keyImages.length ? ` (${keyImages.length})` : ''}
        </button>
        <button
          type="button"
          className={tab === 'measurements' ? 'is-active' : ''}
          onClick={() => setTab('measurements')}
        >
          Measure{measurements.length ? ` (${measurements.length})` : ''}
        </button>
      </div>

      {tab === 'keyImages' ? (
        <div className="ohif-mobile-tools-sheet__body">
          {!keyImages.length ? (
            <div className="ohif-mobile-tools-sheet__empty">
              <p>No key images yet.</p>
              <button
                type="button"
                className="ohif-mobile-tools-sheet__cta"
                onClick={addKeyImage}
              >
                Save current frame
              </button>
            </div>
          ) : (
            <div className="ohif-mobile-tools-sheet__key-grid">
              {keyImages.map((item: any, index: number) => (
                <div
                  key={item.id || item.keyImageId || index}
                  className="ohif-mobile-tools-sheet__key-card"
                >
                  {item.imageSrc || item.thumbnailSrc || item.dataUrl ? (
                    <img
                      src={item.imageSrc || item.thumbnailSrc || item.dataUrl}
                      alt=""
                    />
                  ) : (
                    <span>Key {index + 1}</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="ohif-mobile-tools-sheet__body">
          {!measurements.length ? (
            <div className="ohif-mobile-tools-sheet__empty">
              <p>No measurements yet. Use Measure on the bottom bar.</p>
            </div>
          ) : (
            <ul className="ohif-mobile-tools-sheet__measure-list">
              {measurements.map((m: any) => {
                const label =
                  m.label ||
                  m.toolName ||
                  m.type ||
                  'Measurement';
                const value =
                  m.displayText?.[0] ||
                  m.data?.length?.toFixed?.(1) ||
                  m.text ||
                  '';
                return (
                  <li key={m.uid || m.id}>
                    <button
                      type="button"
                      className="ohif-mobile-tools-sheet__measure-item"
                      onClick={() => jumpToMeasurement(m)}
                    >
                      <span className="ohif-mobile-tools-sheet__measure-title">{label}</span>
                      <span className="ohif-mobile-tools-sheet__measure-meta">
                        {[value, m.SeriesNumber != null ? `S${m.SeriesNumber}` : null]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

export default MobileToolsSheet;
