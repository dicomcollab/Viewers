import React from 'react';
import { Icons } from '@ohif/ui-next';
import { useCineSyncMode } from '../../hooks/useCineSyncMode';
import {
  getCineSyncModeOption,
  getNextCineSyncMode,
  type CineSyncMode,
} from '../../utils/cineSyncModeStore';
import { applyCineSyncMode } from '../../utils/usCinePlaybackUtils';

type CineSyncModeControlProps = {
  servicesManager: AppTypes.ServicesManager;
  className?: string;
};

/** Link icon, struck through when sync is off, with the mode letter beside it. */
function SyncModeIcon({ mode, badge }: { mode: CineSyncMode; badge: string }) {
  return (
    <span className="inline-flex items-center gap-px">
      <span className="relative inline-flex h-3 w-3 items-center justify-center">
        <Icons.ByName
          name="link"
          className="h-3 w-3"
        />
        {mode === 'none' ? (
          <span
            className="absolute h-[1.5px] w-[130%] rotate-45 rounded-full bg-current"
            aria-hidden
          />
        ) : null}
      </span>
      {badge ? (
        <span className="text-[8px] font-bold leading-none">{badge}</span>
      ) : null}
    </span>
  );
}

/**
 * One button that cycles: no sync play → play sync start (S) → sync playback (P).
 */
function CineSyncModeControl({ servicesManager, className }: CineSyncModeControlProps) {
  const [mode, setMode] = useCineSyncMode();
  const option = getCineSyncModeOption(mode);
  const nextOption = getCineSyncModeOption(getNextCineSyncMode(mode));
  const isSynced = mode !== 'none';

  return (
    <button
      type="button"
      className={`inline-flex h-5 shrink-0 items-center rounded px-1 transition-colors ${
        isSynced
          ? 'bg-primary text-primary-foreground ring-1 ring-primary/40'
          : 'text-white/80 hover:bg-white/10 hover:text-white'
      } ${className ?? ''}`}
      onClick={() => {
        const next = getNextCineSyncMode(mode);

        setMode(next);
        applyCineSyncMode(servicesManager, next);
      }}
      title={`${option.label} — ${option.description}\nClick for: ${nextOption.label}`}
      aria-label={`Cine sync: ${option.label}. Click for ${nextOption.label}`}
      data-cy="cine-sync-mode-toggle"
      data-cine-sync-mode={mode}
    >
      <SyncModeIcon
        mode={mode}
        badge={option.badge}
      />
    </button>
  );
}

export default CineSyncModeControl;
