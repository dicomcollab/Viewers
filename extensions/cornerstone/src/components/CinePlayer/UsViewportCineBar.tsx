import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Icons, Button, Numeric } from '@ohif/ui-next';
import { stepUsViewportFrame } from '../../utils/usCinePlaybackUtils';
import type { UsStackCineInfo } from '../../utils/usStackCineUtils';
import {
  activeTransportClass,
  modeChipClass,
  setViewportUsCineLayout,
  type CinePlayMode,
} from './usCineUiUtils';
import './usViewportCine.css';

const ICON_BTN =
  'h-5 w-5 shrink-0 p-0 transition-colors [&_svg]:h-3 [&_svg]:w-3';
const FRAME_BTN = `${ICON_BTN} text-white/80 hover:bg-white/10 hover:text-white`;
const COMPACT_WIDTH_PX = 360;
const ULTRA_COMPACT_WIDTH_PX = 280;

type UsViewportCineBarProps = {
  viewportId: string;
  servicesManager: AppTypes.ServicesManager;
  isPlaying: boolean;
  frameRate: number;
  frameStep: number;
  cinePlayMode: CinePlayMode;
  stackCineInfo: UsStackCineInfo | null;
  onPlayPauseChange: (playing: boolean) => void;
  onStop: () => void;
  onFrameRateChange: (fps: number) => void;
  onFrameStepChange: (step: number) => void;
  onPlayModeChange: (mode: CinePlayMode) => void;
  onFrameChange: (frame: number) => void;
};

function CompactStepper({
  value,
  min,
  max,
  label,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  label: string;
  onChange: (v: number) => void;
}) {
  const stop = (e: React.MouseEvent) => e.stopPropagation();

  const dec = (e: React.MouseEvent) => {
    stop(e);
    onChange(Math.max(min, value - 1));
  };

  const inc = (e: React.MouseEvent) => {
    stop(e);
    onChange(Math.min(max, value + 1));
  };

  return (
    <div
      className="inline-flex h-5 max-w-full items-center gap-px rounded bg-black/40 px-0.5 text-[9px] text-white"
      onClick={stop}
    >
      <button
        type="button"
        className="flex h-4 w-3.5 shrink-0 items-center justify-center rounded hover:bg-white/15"
        onClick={dec}
        aria-label={`Decrease ${label}`}
      >
        ‹
      </button>
      <span className="min-w-[1.1rem] shrink-0 text-center tabular-nums">{value}</span>
      <button
        type="button"
        className="flex h-4 w-3.5 shrink-0 items-center justify-center rounded hover:bg-white/15"
        onClick={inc}
        aria-label={`Increase ${label}`}
      >
        ›
      </button>
      <span className="shrink-0 pl-0.5 text-[8px] text-white/60">{label}</span>
    </div>
  );
}

function UsViewportCineBar({
  viewportId,
  servicesManager,
  isPlaying,
  frameRate,
  frameStep,
  cinePlayMode,
  stackCineInfo,
  onPlayPauseChange,
  onStop,
  onFrameRateChange,
  onFrameStepChange,
  onPlayModeChange,
  onFrameChange,
}: UsViewportCineBarProps) {
  const [localFps, setLocalFps] = useState(frameRate);
  const [localStep, setLocalStep] = useState(frameStep);
  const [barWidth, setBarWidth] = useState(0);
  const barRef = useRef<HTMLDivElement>(null);
  const fpsRef = useRef(frameRate);
  const stepRef = useRef(frameStep);

  const { cornerstoneViewportService } = servicesManager.services;

  useEffect(() => {
    fpsRef.current = frameRate;
    setLocalFps(frameRate);
  }, [frameRate]);

  useEffect(() => {
    stepRef.current = frameStep;
    setLocalStep(frameStep);
  }, [frameStep]);

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

  const numFrames = stackCineInfo?.numFrames ?? 0;
  const currentFrame = stackCineInfo?.currentFrame ?? 1;

  const handleStepFrame = useCallback(
    (direction: 1 | -1) => {
      stepUsViewportFrame(servicesManager, viewportId, direction);
      const next = Math.max(1, Math.min(numFrames, currentFrame + direction));
      onFrameChange(next);
    },
    [currentFrame, numFrames, onFrameChange, servicesManager, viewportId]
  );

  const handleFpsChange = (val: number) => {
    const next = Math.max(5, Math.min(90, Math.round(val)));
    fpsRef.current = next;
    setLocalFps(next);
    onPlayModeChange('fps');
    onFrameRateChange(next);
  };

  const handleStepChange = (val: number) => {
    const next = Math.max(1, Math.min(99, Math.round(val)));
    stepRef.current = next;
    setLocalStep(next);
    onPlayModeChange('step');
    onFrameStepChange(next);
  };

  if (!stackCineInfo || numFrames <= 1) {
    return null;
  }

  const isCompact = barWidth > 0 && barWidth < COMPACT_WIDTH_PX;
  const isUltraCompact = barWidth > 0 && barWidth < ULTRA_COMPACT_WIDTH_PX;
  const showFps = !isCompact || cinePlayMode === 'fps';
  const showFr = !isCompact || cinePlayMode === 'step';

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
          className={`${ICON_BTN} rounded-sm ${isPlaying ? activeTransportClass(true) : 'text-white/90 hover:bg-white/10'}`}
          onClick={() => onPlayPauseChange(!isPlaying)}
          title={isPlaying ? 'Pause' : 'Play'}
          data-cy="cine-player-play-pause"
        >
          <Icons.ByName name={isPlaying ? 'icon-pause' : 'icon-play'} />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className={`${ICON_BTN} rounded-sm text-white/90 hover:bg-white/10`}
          onClick={onStop}
          title="Stop"
          data-cy="cine-player-stop"
        >
          <span className="inline-block h-2 w-2 rounded-[1px] bg-current" />
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

      <div className="min-w-[2rem] flex-1 px-1">
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

      <div className="flex max-w-[38%] shrink-0 items-center gap-0.5 overflow-hidden">
        {showFps && (
          <div
            role="button"
            tabIndex={0}
            className={modeChipClass(cinePlayMode === 'fps')}
            onClick={() => onPlayModeChange('fps')}
            onKeyDown={e => e.key === 'Enter' && onPlayModeChange('fps')}
            title="FPS mode"
            data-cy="cine-player-fps-mode"
          >
            <CompactStepper
              value={localFps}
              min={5}
              max={90}
              label="FPS"
              onChange={handleFpsChange}
            />
          </div>
        )}
        {showFr && (
          <div
            role="button"
            tabIndex={0}
            className={modeChipClass(cinePlayMode === 'step')}
            onClick={() => onPlayModeChange('step')}
            onKeyDown={e => e.key === 'Enter' && onPlayModeChange('step')}
            title="Step mode"
            data-cy="cine-player-step-mode"
          >
            <CompactStepper
              value={localStep}
              min={1}
              max={99}
              label="fr"
              onChange={handleStepChange}
            />
          </div>
        )}
      </div>
    </div>
  );
}

export default UsViewportCineBar;
