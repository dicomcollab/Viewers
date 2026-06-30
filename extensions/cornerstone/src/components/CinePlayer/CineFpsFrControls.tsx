import React, { useEffect, useRef, useState } from 'react';
import { modeChipClass, type CinePlayMode } from './usCineUiUtils';

function CompactStepper({
  value,
  min,
  max,
  label,
  isModeActive,
  onChange,
  onLabelClick,
}: {
  value: number;
  min: number;
  max: number;
  label: string;
  isModeActive: boolean;
  onChange: (v: number) => void;
  onLabelClick: () => void;
}) {
  const stop = (e: React.MouseEvent) => e.stopPropagation();

  return (
    <div className="inline-flex h-5 max-w-full items-center gap-px rounded bg-black/40 px-0.5 text-[9px] text-white">
      <button
        type="button"
        className="flex h-4 w-3.5 shrink-0 items-center justify-center rounded hover:bg-white/15"
        onClick={e => {
          stop(e);
          onChange(Math.max(min, value - 1));
        }}
        aria-label={`Decrease ${label}`}
      >
        ‹
      </button>
      <span className="min-w-[1.1rem] shrink-0 text-center tabular-nums">{value}</span>
      <button
        type="button"
        className="flex h-4 w-3.5 shrink-0 items-center justify-center rounded hover:bg-white/15"
        onClick={e => {
          stop(e);
          onChange(Math.min(max, value + 1));
        }}
        aria-label={`Increase ${label}`}
      >
        ›
      </button>
      <button
        type="button"
        className={`shrink-0 rounded px-0.5 pl-0.5 text-[8px] font-medium transition-colors ${
          isModeActive ? 'text-primary-foreground' : 'text-white/60 hover:text-white'
        }`}
        onClick={e => {
          stop(e);
          onLabelClick();
        }}
        aria-pressed={isModeActive}
        title={label === 'FPS' ? 'FPS mode' : 'Frame step mode'}
        data-cy={label === 'FPS' ? 'cine-player-fps-mode' : 'cine-player-step-mode'}
      >
        {label}
      </button>
    </div>
  );
}

type CineFpsFrControlsProps = {
  frameRate: number;
  frameStep: number;
  cinePlayMode: CinePlayMode;
  onFrameRateChange: (fps: number) => void;
  onFrameStepChange: (step: number) => void;
  onPlayModeChange: (mode: CinePlayMode) => void;
};

function CineFpsFrControls({
  frameRate,
  frameStep,
  cinePlayMode,
  onFrameRateChange,
  onFrameStepChange,
  onPlayModeChange,
}: CineFpsFrControlsProps) {
  const [localFps, setLocalFps] = useState(frameRate);
  const [localStep, setLocalStep] = useState(frameStep);
  const fpsRef = useRef(frameRate);
  const stepRef = useRef(frameStep);

  useEffect(() => {
    fpsRef.current = frameRate;
    setLocalFps(frameRate);
  }, [frameRate]);

  useEffect(() => {
    stepRef.current = frameStep;
    setLocalStep(frameStep);
  }, [frameStep]);

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

  return (
    <div className="flex shrink-0 items-center gap-0.5">
      <div className={modeChipClass(cinePlayMode === 'fps')}>
        <CompactStepper
          value={localFps}
          min={5}
          max={90}
          label="FPS"
          isModeActive={cinePlayMode === 'fps'}
          onChange={handleFpsChange}
          onLabelClick={() => onPlayModeChange('fps')}
        />
      </div>
      <div className={modeChipClass(cinePlayMode === 'step')}>
        <CompactStepper
          value={localStep}
          min={1}
          max={99}
          label="fr"
          isModeActive={cinePlayMode === 'step'}
          onChange={handleStepChange}
          onLabelClick={() => onPlayModeChange('step')}
        />
      </div>
    </div>
  );
}

export default CineFpsFrControls;
export type { CineFpsFrControlsProps };
