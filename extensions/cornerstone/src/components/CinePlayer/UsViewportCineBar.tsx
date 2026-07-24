import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Icons, Button, Numeric } from '@ohif/ui-next';
import { stepUsViewportFrame } from '../../utils/usCinePlaybackUtils';
import type { UsStackCineInfo } from '../../utils/usStackCineUtils';
import { activeTransportClass, setViewportUsCineLayout } from './usCineUiUtils';
import './usViewportCine.css';

const ICON_BTN =
  'h-5 w-5 shrink-0 p-0 transition-colors [&_svg]:h-3 [&_svg]:w-3';
const FRAME_BTN = `${ICON_BTN} text-white/80 hover:bg-white/10 hover:text-white`;
const ULTRA_COMPACT_WIDTH_PX = 280;

type UsViewportCineBarProps = {
  viewportId: string;
  servicesManager: AppTypes.ServicesManager;
  isPlaying: boolean;
  stackCineInfo: UsStackCineInfo | null;
  onPlayPauseChange: (playing: boolean) => void;
  onFrameChange: (frame: number) => void;
};

function UsViewportCineBar({
  viewportId,
  servicesManager,
  isPlaying,
  stackCineInfo,
  onPlayPauseChange,
  onFrameChange,
}: UsViewportCineBarProps) {
  const [barWidth, setBarWidth] = useState(0);
  const barRef = useRef<HTMLDivElement>(null);

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

  if (!stackCineInfo || numFrames <= 1) {
    return null;
  }

  const isUltraCompact = barWidth > 0 && barWidth < ULTRA_COMPACT_WIDTH_PX;

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
    </div>
  );
}

export default UsViewportCineBar;
