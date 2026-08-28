import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Icons, Button, Numeric, useCine } from '@ohif/ui-next';
import type { UsStackCineInfo } from '../../utils/usStackCineUtils';
import { getUsCineCapableLayoutViewportIds } from '../../utils/usGridViewportUtils';
import { useCineSyncMode } from '../../hooks/useCineSyncMode';
import { activeTransportClass, setViewportUsCineLayout } from './usCineUiUtils';
import CineSyncModeControl from './CineSyncModeControl';
import './usViewportCine.css';

const ICON_BTN =
  'h-5 w-5 shrink-0 p-0 transition-colors [&_svg]:h-3 [&_svg]:w-3';
const FRAME_BTN = `${ICON_BTN} text-white/80 hover:bg-white/10 hover:text-white`;
const FPS_STEP_BTN =
  'flex h-4 w-3.5 shrink-0 items-center justify-center rounded text-[11px] font-normal leading-none text-white/90 hover:bg-white/10 hover:text-white/90';
const ULTRA_COMPACT_WIDTH_PX = 280;
const FPS_MIN = 1;
const FPS_MAX = 90;

type UsViewportCineBarProps = {
  viewportId: string;
  servicesManager: AppTypes.ServicesManager;
  isPlaying: boolean;
  /** Current FPS for this viewport instance. */
  frameRate?: number;
  stackCineInfo: UsStackCineInfo | null;
  onPlayPauseChange: (playing: boolean) => void;
  onFrameChange: (frame: number) => void;
  /** Change FPS for this viewport only (does not affect other tiles). */
  onFrameRateChange?: (fps: number) => void;
};

function UsViewportCineBar({
  viewportId,
  servicesManager,
  isPlaying,
  frameRate,
  stackCineInfo,
  onPlayPauseChange,
  onFrameChange,
  onFrameRateChange,
}: UsViewportCineBarProps) {
  const [barWidth, setBarWidth] = useState(0);
  const [localFps, setLocalFps] = useState(() =>
    frameRate != null && Number.isFinite(frameRate) ? Math.round(frameRate) : null
  );
  const barRef = useRef<HTMLDivElement>(null);
  const [{ cines }] = useCine();
  const [syncMode] = useCineSyncMode();

  // With sync playback only the master viewport runs a clip, so the transport
  // state of every bar follows the layout instead of this viewport alone.
  // CT/MR have no US layout peers — fall back to this viewport's play state.
  const isLayoutPlaying = useMemo(() => {
    if (syncMode === 'none') {
      return isPlaying;
    }

    const usLayoutIds = getUsCineCapableLayoutViewportIds(servicesManager);

    if (!usLayoutIds.length) {
      return isPlaying;
    }

    return usLayoutIds.some(id => cines?.[id]?.isPlaying);
  }, [cines, isPlaying, servicesManager, syncMode]);

  const showSyncControl = useMemo(
    () => getUsCineCapableLayoutViewportIds(servicesManager).length > 0,
    [cines, servicesManager]
  );

  const { cornerstoneViewportService } = servicesManager.services;

  useEffect(() => {
    const resize = () => cornerstoneViewportService.resize();
    setViewportUsCineLayout(viewportId, true, resize);
    return () => setViewportUsCineLayout(viewportId, false, resize);
  }, [cornerstoneViewportService, viewportId]);

  useEffect(() => {
    const node = barRef.current;
    if (!node || typeof ResizeObserver === 'undefined') {
      return;
    }

    const observer = new ResizeObserver(entries => {
      setBarWidth(entries[0]?.contentRect.width ?? 0);
    });

    observer.observe(node);
    setBarWidth(node.clientWidth);

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (frameRate != null && Number.isFinite(frameRate) && frameRate > 0) {
      setLocalFps(Math.round(frameRate));
    }
  }, [frameRate]);

  const numFrames = stackCineInfo?.numFrames ?? 0;
  const currentFrame = stackCineInfo?.currentFrame ?? 1;

  const handleStepFrame = useCallback(
    (direction: 1 | -1) => {
      if (numFrames <= 1) {
        return;
      }

      const next = ((currentFrame - 1 + direction + numFrames) % numFrames) + 1;
      onFrameChange(next);
    },
    [currentFrame, numFrames, onFrameChange]
  );

  const handleFpsChange = useCallback(
    (next: number) => {
      const clamped = Math.max(FPS_MIN, Math.min(FPS_MAX, Math.round(next)));
      setLocalFps(clamped);
      onFrameRateChange?.(clamped);
    },
    [onFrameRateChange]
  );

  // Intentionally do not open the Cine "Frame Rate" settings panel from here.
  // The FPS controls (-/+) are sufficient and avoid an extra menu cluttering
  // the measurements/side panel area.

  if (!stackCineInfo || numFrames <= 1) {
    return null;
  }

  const isUltraCompact = barWidth > 0 && barWidth < ULTRA_COMPACT_WIDTH_PX;
  const showFpsControl = localFps != null && localFps > 0 && !!onFrameRateChange;

  return (
    <div
      ref={barRef}
      className="us-viewport-cine-bar pointer-events-auto z-50 flex min-w-0 items-center gap-0.5 border-t border-white/15 bg-black/95 px-1"
      data-cy={`us-viewport-cine-bar-${viewportId}`}
    >
      <div className="flex shrink-0 items-center gap-px">
        <Button
          variant="ghost"
          size="icon"
          className={`${ICON_BTN} rounded-sm ${activeTransportClass(isLayoutPlaying)}`}
          onClick={() => onPlayPauseChange(!isLayoutPlaying)}
          title={isLayoutPlaying ? 'Pause' : 'Play'}
          data-cy="cine-player-play-pause"
        >
          <Icons.ByName name={isLayoutPlaying ? 'icon-pause' : 'icon-play'} />
        </Button>
      </div>

      <span className="mx-px h-3.5 w-px shrink-0 bg-white/20" aria-hidden />

      {!isUltraCompact && (
        <div className="flex shrink-0 items-center gap-px">
          <Button
            variant="ghost"
            size="icon"
            className={FRAME_BTN}
            onClick={() => handleStepFrame(-1)}
            title="Previous frame"
            data-cy="cine-player-prev-frame"
          >
            <Icons.ChevronLeft />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className={FRAME_BTN}
            onClick={() => handleStepFrame(1)}
            title="Next frame"
            data-cy="cine-player-next-frame"
          >
            <Icons.ChevronRight />
          </Button>
        </div>
      )}
      <span
        className="w-8 shrink-0 text-center text-[9px] leading-none text-white/90 tabular-nums"
        data-cy="cine-player-frames-trigger"
      >
        {currentFrame}/{numFrames}
      </span>

      {showFpsControl ? (
        <div
          className="inline-flex h-5 shrink-0 items-center gap-px rounded bg-black/40 px-0.5 text-[9px] leading-none text-white/90"
          data-cy="cine-player-viewport-fps"
          title="FPS for this viewport only"
        >
          {!isUltraCompact ? (
            <button
              type="button"
              className={FPS_STEP_BTN}
              onClick={() => handleFpsChange(localFps - 1)}
              aria-label="Decrease FPS"
              data-cy="cine-player-viewport-fps-decrease"
            >
              −
            </button>
          ) : null}
          <span
            className="flex h-4 shrink-0 items-center gap-0.5 rounded px-0.5"
            title="FPS for this viewport"
            data-cy="cine-player-viewport-fps"
          >
            <span className="min-w-[1.1rem] text-center tabular-nums">
              {localFps}
            </span>
            <span className="text-[8px] font-normal text-white/90">FPS</span>
          </span>
          {!isUltraCompact ? (
            <button
              type="button"
              className={FPS_STEP_BTN}
              onClick={() => handleFpsChange(localFps + 1)}
              aria-label="Increase FPS"
              data-cy="cine-player-viewport-fps-increase"
            >
              +
            </button>
          ) : null}
        </div>
      ) : localFps != null && localFps > 0 ? (
        <span
          className="shrink-0 px-0.5 text-[9px] font-normal leading-none text-white/90 tabular-nums"
          data-cy="cine-player-viewport-fps"
        >
          {localFps} FPS
        </span>
      ) : null}

      <div className="us-viewport-cine-slider min-w-[2rem] flex-1 px-1">
        <Numeric.Container
          mode="singleRange"
          min={1}
          max={numFrames}
          step={1}
          value={currentFrame}
          onChange={val => onFrameChange(val as number)}
          className="w-full min-w-0"
        >
          <Numeric.SingleRange
            showNumberInput={false}
            sliderClassName="h-1 w-full min-w-0 cursor-pointer"
            sliderVariant="white"
          />
        </Numeric.Container>
      </div>

      {showSyncControl ? <CineSyncModeControl servicesManager={servicesManager} /> : null}
    </div>
  );
}

export default UsViewportCineBar;
