import React, { useCallback, useEffect, useState } from 'react';
import { useActiveViewportDisplaySets } from '@ohif/core';

type PanelKeyImagesProps = {
  servicesManager: AppTypes.ServicesManager;
  commandsManager: AppTypes.CommandsManager;
};

function PanelKeyImages({ servicesManager, commandsManager }: PanelKeyImagesProps) {
  const { keyImagesService, hangingProtocolService } = servicesManager.services as AppTypes.Services & {
    keyImagesService: {
      getKeyImagesForStudy: (studyInstanceUID?: string | null) => any[];
      isAddingKeyImage: () => boolean;
      subscribe: (eventName: string, cb: (evt: any) => void) => { unsubscribe: () => void };
      EVENTS: { KEY_IMAGES_CHANGED: string; KEY_IMAGES_ADDING_CHANGED: string };
    };
  };

  const activeDisplaySets = useActiveViewportDisplaySets();

  const resolveActiveStudyUID = useCallback(() => {
    return (
      hangingProtocolService?.getState?.()?.activeStudyUID ||
      activeDisplaySets?.[0]?.StudyInstanceUID ||
      null
    );
  }, [activeDisplaySets, hangingProtocolService]);

  const refreshKeyImages = useCallback(() => {
    setKeyImages(keyImagesService.getKeyImagesForStudy(resolveActiveStudyUID()));
  }, [keyImagesService, resolveActiveStudyUID]);

  const activeStudyUID = resolveActiveStudyUID();
  const [keyImages, setKeyImages] = useState(() =>
    keyImagesService.getKeyImagesForStudy(resolveActiveStudyUID())
  );
  const [isSaving, setIsSaving] = useState(false);
  const [isAdding, setIsAdding] = useState(() => keyImagesService.isAddingKeyImage());

  useEffect(() => {
    refreshKeyImages();
  }, [refreshKeyImages]);

  useEffect(() => {
    const refresh = () => refreshKeyImages();

    const subscriptions = [
      keyImagesService.subscribe(keyImagesService.EVENTS.KEY_IMAGES_CHANGED, refresh),
      keyImagesService.subscribe(keyImagesService.EVENTS.KEY_IMAGES_ADDING_CHANGED, ({ isAdding }) =>
        setIsAdding(Boolean(isAdding))
      ),
    ];

    if (hangingProtocolService?.subscribe && hangingProtocolService?.EVENTS?.PROTOCOL_CHANGED) {
      subscriptions.push(
        hangingProtocolService.subscribe(
          hangingProtocolService.EVENTS.PROTOCOL_CHANGED,
          refresh
        )
      );
    }

    return () => subscriptions.forEach(sub => sub.unsubscribe());
  }, [keyImagesService, hangingProtocolService, refreshKeyImages]);

  const onSave = async () => {
    setIsSaving(true);
    try {
      await commandsManager.run('saveKeyImages');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="ohif-scrollbar flex h-full flex-col gap-2 overflow-y-auto p-2 text-white">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold">Key Images</div>
        <button
          className="bg-primary-main hover:bg-primary-dark rounded px-2 py-1 text-xs"
          onClick={onSave}
          disabled={isSaving || keyImages.length === 0}
        >
          {isSaving ? 'Saving...' : 'Save'}
        </button>
      </div>

      {isAdding && (
        <div className="text-muted-foreground text-xs italic">Adding key image...</div>
      )}

      {keyImages.length === 0 && !isAdding && (
        <div className="text-muted-foreground text-xs">
          {activeStudyUID
            ? 'No key images for this study. Use the Add Key Image toolbar button.'
            : 'No active study. Open a study to add key images.'}
        </div>
      )}

      {keyImages.map(item => (
        <div
          key={item.id}
          className="bg-secondary-dark border-secondary-main flex gap-2 rounded border p-2"
        >
          <img
            src={item.dataUrl}
            alt="key-image"
            className="h-16 w-16 rounded object-cover"
          />
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="truncate text-xs">{item.sopInstanceUID || item.imageId || item.id}</div>
            <div className="text-muted-foreground text-[10px]">
              {item.imageIndex !== undefined && item.imageIndex !== null
                ? `Image #${item.imageIndex + 1}`
                : 'Volume view'}
            </div>
            <div className="mt-1 flex gap-1">
              <button
                className="rounded bg-slate-700 px-2 py-0.5 text-[10px]"
                onClick={() => commandsManager.run('jumpToKeyImage', { keyImageId: item.id })}
              >
                Go To
              </button>
              <button
                className="rounded bg-red-700 px-2 py-0.5 text-[10px]"
                onClick={() => commandsManager.run('removeKeyImage', { keyImageId: item.id })}
              >
                Remove
              </button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export default PanelKeyImages;
