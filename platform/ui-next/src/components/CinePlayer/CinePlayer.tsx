import React, { useEffect, useState, useCallback, useRef } from 'react';
import PropTypes from 'prop-types';

import { Icons } from '@ohif/ui-next';
import { Popover, PopoverContent, PopoverTrigger } from '../Popover/Popover';
import { Button } from '../Button/Button';
import { Numeric } from '../Numeric/Numeric';

export type CinePlayerProps = {
  className?: string;
  portaled?: boolean;
  placement?: 'bottom-center' | 'top-center';
  compact?: boolean;
  isPlaying: boolean;
  minFrameRate?: number;
  maxFrameRate?: number;
  stepFrameRate?: number;
  frameRate?: number;
  cinePlayMode?: 'fps' | 'step';
  frameStep?: number;
  onFrameRateChange: (value: number) => void;
  onCinePlayModeChange?: (mode: 'fps' | 'step') => void;
  onFrameStepChange?: (step: number) => void;
  onPlayPauseChange: (value: boolean) => void;
  onStop?: () => void;
  onClose: () => void;
  updateDynamicInfo?: (info: any) => void;
  dynamicInfo?: {
    dimensionGroupNumber: number;
    numDimensionGroups: number;
    label?: string;
  };
  stackCineInfo?: {
    currentFrame: number;
    numFrames: number;
    batchSize?: number;
    batchStart?: number;
    batchEnd?: number;
    currentPage?: number;
    totalPages?: number;
    seriesIndex?: number;
    totalSeries?: number;
    hasNextBatch?: boolean;
    hasPrevBatch?: boolean;
  };
  /** Hide current/total frame label when multiple viewports run in parallel with different lengths. */
  showStackFrameCounter?: boolean;
  updateStackCineInfo?: (info: { currentFrame?: number }) => void;
  onAdvanceUsBatch?: () => void;
  onRetreatUsBatch?: () => void;
};

const placementClassMap = {
  'bottom-center': 'bottom-2 left-1/2 -translate-x-1/2',
  'top-center': 'top-2 left-1/2 -translate-x-1/2',
};

const CinePlayer: React.FC<CinePlayerProps> = ({
  className = '',
  portaled = false,
  placement = 'bottom-center',
  compact = false,
  isPlaying = false,
  minFrameRate = 1,
  maxFrameRate = 90,
  stepFrameRate = 1,
  frameRate: defaultFrameRate = 24,
  cinePlayMode = 'step',
  frameStep: defaultFrameStep = 4,
  onFrameRateChange = () => {},
  onCinePlayModeChange = () => {},
  onFrameStepChange = () => {},
  onPlayPauseChange = () => {},
  onStop = () => {},
  onClose = () => {},
  dynamicInfo = {},
  updateDynamicInfo,
  stackCineInfo,
  showStackFrameCounter = true,
  updateStackCineInfo,
  onAdvanceUsBatch,
  onRetreatUsBatch,
}) => {
  const isDynamic = !!dynamicInfo?.numDimensionGroups;
  const isStackCine = !!stackCineInfo?.numFrames && stackCineInfo.numFrames > 1;
  const showFrameCounter = isStackCine && showStackFrameCounter;
  const [frameRate, setFrameRate] = useState(defaultFrameRate);
  const [playMode, setPlayMode] = useState<'fps' | 'step'>(cinePlayMode);
  const [frameStep, setFrameStep] = useState(defaultFrameStep);
  const [scrubPopoverOpen, setScrubPopoverOpen] = useState(false);
  const [fpsPopoverOpen, setFpsPopoverOpen] = useState(false);
  const [stepPopoverOpen, setStepPopoverOpen] = useState(false);
  const frameRateRef = useRef(defaultFrameRate);
  const frameStepRef = useRef(defaultFrameStep);
  const playModeRef = useRef<'fps' | 'step'>(cinePlayMode);

  const getPlayPauseIconName = () => (isPlaying ? 'icon-pause' : 'icon-play');

  const flushCineSettings = useCallback(() => {
    const mode = playModeRef.current;
    onCinePlayModeChange(mode);

    // Keep mode-specific settings from fighting each other.
    // Previously this always emitted frameStep, which could flip the cine mode back to `step`
    // right before playback starts.
    if (mode === 'fps') {
      onFrameRateChange(frameRateRef.current);
      return;
    }

    onFrameStepChange(frameStepRef.current);
  }, [onCinePlayModeChange, onFrameRateChange, onFrameStepChange]);

  const handleSetFrameRate = (nextFrameRate: number) => {
    if (nextFrameRate < minFrameRate || nextFrameRate > maxFrameRate) {
      return;
    }
    frameRateRef.current = nextFrameRate;
    playModeRef.current = 'fps';
    setFrameRate(nextFrameRate);
    setPlayMode('fps');
    onCinePlayModeChange('fps');
    onFrameRateChange(nextFrameRate);
  };

  const handleSetFrameStep = (nextFrameStep: number) => {
    const clamped = Math.max(1, Math.min(99, Math.round(nextFrameStep)));
    frameStepRef.current = clamped;
    playModeRef.current = 'step';
    setFrameStep(clamped);
    setPlayMode('step');
    onCinePlayModeChange('step');
    onFrameStepChange(clamped);
  };

  const handlePlayPauseClick = () => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    flushCineSettings();
    onPlayPauseChange(!isPlaying);
  };

  const handleStopClick = () => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    flushCineSettings();
    onStop();
  };

  useEffect(() => {
    frameRateRef.current = defaultFrameRate;
    setFrameRate(defaultFrameRate);
  }, [defaultFrameRate]);

  useEffect(() => {
    playModeRef.current = cinePlayMode;
    setPlayMode(cinePlayMode);
  }, [cinePlayMode]);

  useEffect(() => {
    frameStepRef.current = defaultFrameStep;
    setFrameStep(defaultFrameStep);
  }, [defaultFrameStep]);

  const handleDimensionGroupNumberChange = useCallback(
    (newGroupNumber: number) => {
      if (isDynamic && dynamicInfo) {
        updateDynamicInfo?.({
          ...dynamicInfo,
          dimensionGroupNumber: newGroupNumber,
        });
      }
    },
    [isDynamic, dynamicInfo, updateDynamicInfo]
  );

  const handleStackCurrentFrameChange = useCallback(
    (nextFrame: number) => {
      if (!isStackCine) {
        return;
      }

      updateStackCineInfo?.({ currentFrame: nextFrame });
    },
    [isStackCine, updateStackCineInfo]
  );

  const handleAdvanceUsBatchClick = () => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    flushCineSettings();
    onAdvanceUsBatch?.();
  };

  const handleRetreatUsBatchClick = () => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    flushCineSettings();
    onRetreatUsBatch?.();
  };

  const showBatchNavButtons =
    isStackCine && !!onAdvanceUsBatch && !!onRetreatUsBatch && !stackCineInfo?.totalPages;
  const batchLabel =
    stackCineInfo?.currentPage != null && stackCineInfo?.totalPages != null
      ? null
      : stackCineInfo?.batchStart != null &&
          stackCineInfo?.batchEnd != null &&
          (stackCineInfo.batchSize ?? 1) > 1
        ? `${stackCineInfo.batchStart}-${stackCineInfo.batchEnd}/${stackCineInfo.numFrames}`
        : null;
  const barClassName = compact
    ? 'bg-background/90 pointer-events-auto inline-flex h-7 select-none items-center gap-0 rounded border border-white/10 px-0.5 shadow-sm backdrop-blur-sm'
    : 'bg-muted pointer-events-auto inline-flex select-none items-center gap-1 rounded-md px-1 py-1';

  const iconButtonClass = compact ? 'h-6 w-6 shrink-0' : undefined;
  const closeButtonClass = compact
    ? 'h-7 w-7 shrink-0 [&_svg]:h-4 [&_svg]:w-4'
    : 'h-8 w-8 shrink-0 [&_svg]:h-5 [&_svg]:w-5';
  const batchNavButtonClass = compact
    ? 'h-6 w-6 shrink-0 p-0 [&_svg]:h-3.5 [&_svg]:w-3.5'
    : 'h-7 w-7 shrink-0 p-0 [&_svg]:h-4 [&_svg]:w-4';
  const modeChipClass = (active: boolean) =>
    `h-6 rounded px-1.5 text-[11px] leading-none ${
      active ? 'bg-primary/20 text-foreground' : 'text-muted-foreground hover:text-foreground'
    }`;

  const controls = (
    <>
      <div className={barClassName}>
        <Button
          variant="ghost"
          size={compact ? 'sm' : 'icon'}
          className={iconButtonClass}
          onClick={handlePlayPauseClick}
          data-cy={'cine-player-play-pause'}
        >
          <Icons.ByName name={getPlayPauseIconName()} />
        </Button>

        {isStackCine && onStop && (
          <Button
            variant="ghost"
            size={compact ? 'sm' : 'icon'}
            className={iconButtonClass}
            onClick={handleStopClick}
            data-cy="cine-player-stop"
            title="Stop"
          >
            <span className="bg-foreground inline-block h-2.5 w-2.5 rounded-[1px]" />
          </Button>
        )}

        {isDynamic && dynamicInfo && (
          <span className="text-foreground px-1 text-[11px] leading-none whitespace-nowrap">
            {dynamicInfo.dimensionGroupNumber}/{dynamicInfo.numDimensionGroups}
          </span>
        )}

        {showFrameCounter && stackCineInfo && (
          <Popover
            open={scrubPopoverOpen}
            onOpenChange={setScrubPopoverOpen}
          >
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="text-foreground h-6 px-1.5 text-[11px] leading-none"
                data-cy="cine-player-frames-trigger"
              >
                {stackCineInfo.currentFrame}/{stackCineInfo.numFrames}
              </Button>
            </PopoverTrigger>
            <PopoverContent
              side="bottom"
              align="center"
              className="z-50 w-48 p-2"
              sideOffset={6}
            >
              <Numeric.Container
                mode="singleRange"
                min={1}
                max={stackCineInfo.numFrames}
                step={1}
                value={stackCineInfo.currentFrame}
                onChange={val => handleStackCurrentFrameChange(val as number)}
                className="w-full"
              >
                <Numeric.SingleRange
                  showNumberInput={false}
                  sliderClassName="w-full cursor-pointer"
                  sliderVariant="white"
                />
              </Numeric.Container>
            </PopoverContent>
          </Popover>
        )}

        {isStackCine ? (
          <>
            <Popover
              open={fpsPopoverOpen}
              onOpenChange={open => {
                if (!open) {
                  if (document.activeElement instanceof HTMLElement) {
                    document.activeElement.blur();
                  }
                  flushCineSettings();
                }
                setFpsPopoverOpen(open);
              }}
            >
              <PopoverTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className={modeChipClass(playMode === 'fps')}
                  data-cy="cine-player-fps-trigger"
                >
                  {frameRate} FPS
                </Button>
              </PopoverTrigger>
              <PopoverContent
                side="bottom"
                align="center"
                className="z-50 w-auto p-2"
                sideOffset={6}
              >
                <Numeric.Container
                  mode="stepper"
                  min={minFrameRate}
                  max={maxFrameRate}
                  step={stepFrameRate}
                  value={frameRate}
                  onChange={val => handleSetFrameRate(val as number)}
                  className="border-0 bg-transparent"
                >
                  <Numeric.NumberStepper
                    direction="horizontal"
                    inputWidth="min-w-10 w-10"
                    buttonColor="white"
                  >
                    <span className="text-muted-foreground text-[10px]">FPS</span>
                  </Numeric.NumberStepper>
                </Numeric.Container>
              </PopoverContent>
            </Popover>
            <Popover
              open={stepPopoverOpen}
              onOpenChange={open => {
                if (!open) {
                  if (document.activeElement instanceof HTMLElement) {
                    document.activeElement.blur();
                  }
                  flushCineSettings();
                }
                setStepPopoverOpen(open);
              }}
            >
              <PopoverTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className={modeChipClass(playMode === 'step')}
                  data-cy="cine-player-step-trigger"
                >
                  {frameStep} fr
                </Button>
              </PopoverTrigger>
              <PopoverContent
                side="bottom"
                align="center"
                className="z-50 w-auto p-2"
                sideOffset={6}
              >
                <Numeric.Container
                  mode="stepper"
                  min={1}
                  max={99}
                  step={1}
                  value={frameStep}
                  onChange={val => handleSetFrameStep(val as number)}
                  className="border-0 bg-transparent"
                >
                  <Numeric.NumberStepper
                    direction="horizontal"
                    inputWidth="min-w-10 w-10"
                    buttonColor="white"
                  >
                    <span className="text-muted-foreground text-[10px]">Frames/step</span>
                  </Numeric.NumberStepper>
                </Numeric.Container>
              </PopoverContent>
            </Popover>
            {batchLabel && (
              <span
                className="text-muted-foreground px-1 text-[10px] leading-none whitespace-nowrap"
                data-cy="cine-player-batch-label"
              >
                {batchLabel}
              </span>
            )}
            {showBatchNavButtons && (
              <>
                <Button
                  variant="ghost"
                  size={compact ? 'sm' : 'icon'}
                  className={batchNavButtonClass}
                  onClick={handleRetreatUsBatchClick}
                  data-cy="cine-player-prev-batch"
                  title="Previous batch"
                >
                  <Icons.ChevronLeft />
                </Button>
                <Button
                  variant="ghost"
                  size={compact ? 'sm' : 'icon'}
                  className={batchNavButtonClass}
                  onClick={handleAdvanceUsBatchClick}
                  data-cy="cine-player-next-batch"
                  title="Next batch"
                >
                  <Icons.ChevronRight />
                </Button>
              </>
            )}
          </>
        ) : (
          <Popover
            open={fpsPopoverOpen}
            onOpenChange={setFpsPopoverOpen}
          >
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="text-foreground h-6 px-1 text-[11px] leading-none"
                data-cy="cine-player-fps-trigger"
              >
                {frameRate} FPS
              </Button>
            </PopoverTrigger>
            <PopoverContent
              side="bottom"
              align="center"
              className="cine-fps-range-popover z-50 w-auto p-2"
              sideOffset={6}
            >
              <Numeric.Container
                mode="stepper"
                min={minFrameRate}
                max={maxFrameRate}
                step={stepFrameRate}
                value={frameRate}
                onChange={val => handleSetFrameRate(val as number)}
                className="border-0 bg-transparent"
              >
                <Numeric.NumberStepper
                  direction="horizontal"
                  inputWidth="min-w-10 w-10"
                  buttonColor="white"
                >
                  <span className="text-muted-foreground text-[10px]">FPS</span>
                </Numeric.NumberStepper>
              </Numeric.Container>
            </PopoverContent>
          </Popover>
        )}

        <Button
          variant="ghost"
          size={compact ? 'sm' : 'icon'}
          className={closeButtonClass}
          onClick={onClose}
          data-cy={'cine-player-close'}
        >
          <Icons.Close />
        </Button>
      </div>

      {isDynamic && dynamicInfo && !compact && (
        <Numeric.Container
          mode="singleRange"
          min={1}
          max={dynamicInfo.numDimensionGroups}
          step={1}
          value={dynamicInfo.dimensionGroupNumber}
          onChange={val => handleDimensionGroupNumberChange(val as number)}
          className="pointer-events-auto mt-1 w-full"
        >
          <Numeric.SingleRange
            showNumberInput={false}
            sliderClassName="cursor-pointer"
            sliderVariant="white"
          />
        </Numeric.Container>
      )}
    </>
  );

  if (portaled) {
    return <div className="pointer-events-none flex flex-col items-center">{controls}</div>;
  }

  return (
    <div
      className={`pointer-events-none absolute z-50 ${placementClassMap[placement]} ${className}`}
    >
      {controls}
    </div>
  );
};

CinePlayer.propTypes = {
  minFrameRate: PropTypes.number,
  maxFrameRate: PropTypes.number,
  stepFrameRate: PropTypes.number,
  frameRate: PropTypes.number,
  isPlaying: PropTypes.bool.isRequired,
  onPlayPauseChange: PropTypes.func,
  onFrameRateChange: PropTypes.func,
  onClose: PropTypes.func,
  dynamicInfo: PropTypes.shape({
    dimensionGroupNumber: PropTypes.number,
    numDimensionGroups: PropTypes.number,
    label: PropTypes.string,
  }),
};

export default CinePlayer;
