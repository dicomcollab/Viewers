import React, { useCallback, useEffect, useState } from 'react';
import { Button, Icons } from '@ohif/ui-next';
import { navigateSeries } from './mobileDisplaySetUtils';
import './MobileCineBar.css';

type MobileCineBarProps = {
  servicesManager: AppTypes.ServicesManager;
  commandsManager: AppTypes.CommandsManager;
};

/**
 * Dedicated cine + series navigation bar for mobile portrait layout.
 * FPS and image tools live in the navbar.
 */
function MobileCineBar({ servicesManager, commandsManager }: MobileCineBarProps) {
  const { cineService, viewportGridService, cornerstoneViewportService } =
    servicesManager.services;
  const [isPlaying, setIsPlaying] = useState(false);
  const [frameLabel, setFrameLabel] = useState('');
  const [seriesLabel, setSeriesLabel] = useState('');

  const refresh = useCallback(() => {
    const { activeViewportId, viewports } = viewportGridService.getState();
    const cineState = cineService.getState?.() || {};
    const cine = activeViewportId ? cineState.cines?.[activeViewportId] : null;
    setIsPlaying(Boolean(cine?.isPlaying));

    try {
      const vp = cornerstoneViewportService?.getCornerstoneViewport?.(activeViewportId);
      const imageIds = vp?.getImageIds?.() || [];
      const idx =
        typeof vp?.getCurrentImageIdIndex === 'function' ? vp.getCurrentImageIdIndex() : 0;
      if (imageIds.length > 1) {
        setFrameLabel(`${idx + 1}/${imageIds.length}`);
      } else if (imageIds.length === 1) {
        setFrameLabel('1/1');
      } else {
        setFrameLabel('');
      }
    } catch {
      setFrameLabel('');
    }

    try {
      const gridVp = viewports?.get?.(activeViewportId);
      const uid = gridVp?.displaySetInstanceUIDs?.[0];
      const { displaySetService } = servicesManager.services;
      const ds = uid ? displaySetService.getDisplaySetByUID?.(uid) : null;
      if (ds?.SeriesNumber != null) {
        setSeriesLabel(`S${ds.SeriesNumber}`);
      } else {
        setSeriesLabel('');
      }
    } catch {
      setSeriesLabel('');
    }
  }, [cineService, viewportGridService, cornerstoneViewportService, servicesManager]);

  useEffect(() => {
    refresh();
    const subs = [
      cineService.subscribe?.(cineService.EVENTS.CINE_STATE_CHANGED, refresh),
      viewportGridService.subscribe?.(viewportGridService.EVENTS.GRID_STATE_CHANGED, refresh),
      viewportGridService.subscribe?.(
        viewportGridService.EVENTS.ACTIVE_VIEWPORT_ID_CHANGED,
        refresh
      ),
    ].filter(Boolean);

    const timer = window.setInterval(refresh, 500);

    return () => {
      subs.forEach(s => s?.unsubscribe?.());
      window.clearInterval(timer);
    };
  }, [cineService, viewportGridService, refresh]);

  const onPlayPause = () => {
    commandsManager.run('toggleCine');
    window.setTimeout(refresh, 50);
  };

  const onPrevFrame = () => {
    commandsManager.run('previousImage');
    window.setTimeout(refresh, 50);
  };

  const onNextFrame = () => {
    commandsManager.run('nextImage');
    window.setTimeout(refresh, 50);
  };

  const onPrevSeries = () => {
    navigateSeries({ commandsManager, direction: -1 });
    window.setTimeout(refresh, 80);
  };

  const onNextSeries = () => {
    navigateSeries({ commandsManager, direction: 1 });
    window.setTimeout(refresh, 80);
  };

  return (
    <div
      className="ohif-mobile-cine-bar"
      data-cy="mobile-cine-bar"
    >
      <div className="ohif-mobile-cine-bar__group" aria-label="Series">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="ohif-mobile-cine-bar__nav"
          aria-label="Previous series"
          onClick={onPrevSeries}
        >
          <Icons.ChevronLeft />
        </Button>
        <span className="ohif-mobile-cine-bar__series">{seriesLabel || 'Series'}</span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="ohif-mobile-cine-bar__nav"
          aria-label="Next series"
          onClick={onNextSeries}
        >
          <Icons.ChevronRight />
        </Button>
      </div>

      <div className="ohif-mobile-cine-bar__divider" />

      <div className="ohif-mobile-cine-bar__group" aria-label="Frames">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="ohif-mobile-cine-bar__play"
          aria-label={isPlaying ? 'Pause' : 'Play'}
          onClick={onPlayPause}
        >
          {isPlaying ? <Icons.Pause /> : <Icons.Play />}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="ohif-mobile-cine-bar__step"
          aria-label="Previous frame"
          onClick={onPrevFrame}
        >
          <Icons.ChevronLeft />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="ohif-mobile-cine-bar__step"
          aria-label="Next frame"
          onClick={onNextFrame}
        >
          <Icons.ChevronRight />
        </Button>
        {frameLabel ? <span className="ohif-mobile-cine-bar__frames">{frameLabel}</span> : null}
      </div>
    </div>
  );
}

export default MobileCineBar;
