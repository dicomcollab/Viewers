import React, { useCallback, useEffect, useState } from 'react';
import { Button } from '@ohif/ui-next';
import { CommandsManager } from '@ohif/core';
import {
  canUseUsFrameDistribution,
  isUsFrameDistributionEnabled,
  subscribeUsFrameDistribution,
} from '../utils/usFrameDistributionStore';

type FrameDistributionControlProps = {
  commandsManager: CommandsManager;
  servicesManager: AppTypes.ServicesManager;
};

function FrameDistributionControl({
  commandsManager,
  servicesManager,
}: FrameDistributionControlProps) {
  const [enabled, setEnabled] = useState(() => isUsFrameDistributionEnabled());
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    const { displaySetService, viewportGridService, hangingProtocolService } =
      servicesManager.services;

    const refresh = () => {
      setAvailable(canUseUsFrameDistribution(displaySetService));
    };

    refresh();

    const displaySetSub = displaySetService.subscribe(
      displaySetService.EVENTS.DISPLAY_SETS_CHANGED,
      refresh
    );
    const gridSub = viewportGridService.subscribe(
      viewportGridService.EVENTS.GRID_STATE_CHANGED,
      refresh
    );
    const hpSub = hangingProtocolService.subscribe(
      hangingProtocolService.EVENTS.PROTOCOL_CHANGED,
      refresh
    );
    const unsubscribeStore = subscribeUsFrameDistribution(setEnabled);

    return () => {
      displaySetSub.unsubscribe();
      gridSub.unsubscribe();
      hpSub.unsubscribe();
      unsubscribeStore();
    };
  }, [servicesManager]);

  const handleToggle = useCallback(() => {
    commandsManager.run({
      commandName: 'setUsFrameDistribution',
      commandOptions: { enabled: !enabled },
    });
  }, [commandsManager, enabled]);

  if (!available) {
    return null;
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      className={`h-7 shrink-0 rounded px-2 text-[11px] font-medium transition-colors ${
        enabled
          ? 'bg-primary text-primary-foreground shadow-sm ring-2 ring-primary/70'
          : 'border border-white/25 text-white/75 hover:bg-white/10 hover:text-white'
      }`}
      onClick={handleToggle}
      title={
        enabled
          ? 'Frame Dist on — 2×2 static frames; use page next/prev (no cine)'
          : 'Frame Dist off — 1×1 with cine play; click to distribute frames in 2×2'
      }
      aria-pressed={enabled}
      data-cy="frame-distribution-toggle"
      data-frame-distribution-enabled={enabled}
    >
      {enabled ? 'Frame Dist ✓' : 'Frame Dist'}
    </Button>
  );
}

export default FrameDistributionControl;
