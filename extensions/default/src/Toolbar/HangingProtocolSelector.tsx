import React, { useState, useEffect, useCallback } from 'react';
import PropTypes from 'prop-types';
import { CommandsManager } from '@ohif/core';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  Button,
  Icons,
} from '@ohif/ui-next';
import { saveHangingProtocolChoice } from '../utils/viewerLayoutPreferences';

interface HangingProtocolSelectorProps {
  commandsManager: CommandsManager;
  servicesManager: any;
  isCompact?: boolean;
}

const isEmbeddedInIframe = () => {
  try {
    return typeof window !== 'undefined' && window.self !== window.top;
  } catch {
    return true;
  }
};

const protocolOptions = [
  { id: 'allModality1x1', label: '1×1', protocolId: 'allModality1x1', stageId: '1x1' },
  { id: 'allModality1x2', label: '1×2', protocolId: 'allModality1x2', stageId: '1x2' },
  { id: 'allModality2x2', label: '2×2', protocolId: 'allModality2x2', stageId: '2x2' },
  { id: 'allModality2x4', label: '2×4', protocolId: 'allModality2x4', stageId: '2x4' },
];

const LEGACY_PROTOCOL_ID_MAP: Record<string, string> = {
  allModality1x4: 'allModality2x2',
  usModality1x1: 'allModality1x1',
  usModality1x4: 'allModality2x2',
  usModality2x2: 'allModality2x2',
  usModality2x4: 'allModality2x4',
};

function labelForLayout(numRows: number, numCols: number): { label: string; protocolId: string | null } {
  if (numRows === 1 && numCols === 1) {
    return { label: '1×1', protocolId: 'allModality1x1' };
  }
  if (numRows === 1 && numCols === 2) {
    return { label: '1×2', protocolId: 'allModality1x2' };
  }
  if (numRows === 2 && numCols === 2) {
    return { label: '2×2', protocolId: 'allModality2x2' };
  }
  if (numRows === 2 && numCols === 4) {
    return { label: '2×4', protocolId: 'allModality2x4' };
  }
  return { label: '1×1', protocolId: null };
}

function HangingProtocolSelectorWithServices({
  commandsManager,
  servicesManager,
  isCompact = isEmbeddedInIframe(),
}: HangingProtocolSelectorProps) {
  const [currentProtocol, setCurrentProtocol] = useState<string>('1×1');
  const [currentProtocolId, setCurrentProtocolId] = useState<string | null>(null);

  useEffect(() => {
    const { hangingProtocolService, viewportGridService } = servicesManager.services;

    const updateCurrentProtocol = () => {
      const hpState = hangingProtocolService.getState();
      const protocolId = hpState?.protocolId;
      const mappedId = protocolId ? (LEGACY_PROTOCOL_ID_MAP[protocolId] ?? protocolId) : null;

      if (mappedId) {
        const option = protocolOptions.find(opt => opt.protocolId === mappedId);
        if (option) {
          setCurrentProtocol(option.label);
          setCurrentProtocolId(option.protocolId);
          return;
        }

        const layout = viewportGridService?.getState()?.layout;
        if (layout) {
          const matched = labelForLayout(layout.numRows, layout.numCols);
          setCurrentProtocol(matched.label);
          setCurrentProtocolId(matched.protocolId);
          return;
        }
      }

      setCurrentProtocol('1×1');
      setCurrentProtocolId(null);
    };

    const timeoutId = setTimeout(updateCurrentProtocol, 100);
    updateCurrentProtocol();

    const hpSubscription = hangingProtocolService.subscribe(
      hangingProtocolService.EVENTS.PROTOCOL_CHANGED,
      updateCurrentProtocol
    );
    const gridSub = viewportGridService.subscribe(
      viewportGridService.EVENTS.GRID_STATE_CHANGED,
      updateCurrentProtocol
    );

    const unsubscribeHp =
      typeof hpSubscription?.unsubscribe === 'function'
        ? hpSubscription.unsubscribe
        : typeof hpSubscription === 'function'
          ? hpSubscription
          : undefined;

    return () => {
      clearTimeout(timeoutId);
      if (typeof unsubscribeHp === 'function') {
        unsubscribeHp();
      }
      gridSub.unsubscribe();
    };
  }, [servicesManager]);

  const handleProtocolChange = useCallback(
    (option: (typeof protocolOptions)[0]) => {
      setCurrentProtocol(option.label);
      setCurrentProtocolId(option.protocolId);

      commandsManager.run({
        commandName: 'setHangingProtocol',
        commandOptions: {
          protocolId: option.protocolId,
          stageId: option.stageId,
        },
      });
      saveHangingProtocolChoice(
        {
          kind: 'protocol',
          protocolId: option.protocolId,
          stageId: option.stageId,
        },
        servicesManager
      );
    },
    [commandsManager, servicesManager]
  );

  const cycleProtocol = useCallback(
    (direction: 1 | -1) => {
      const currentIndex = protocolOptions.findIndex(opt => opt.protocolId === currentProtocolId);
      const fallbackIndex = currentIndex >= 0 ? currentIndex : 0;
      const nextIndex =
        (fallbackIndex + direction + protocolOptions.length) % protocolOptions.length;
      handleProtocolChange(protocolOptions[nextIndex]);
    },
    [currentProtocolId, handleProtocolChange]
  );

  const navBtnClass =
    'h-6 w-6 shrink-0 p-0 text-white hover:bg-primary-active [&_svg]:h-3 [&_svg]:w-3';

  return (
    <div
      className={`flex items-center ${isCompact ? 'iframe-hanging-protocol mr-0.5 gap-0.5' : 'gap-1'}`}
      id="HangingProtocol"
      data-cy="HangingProtocol"
    >
      {!isCompact && <span className="whitespace-nowrap text-sm text-white">HP</span>}
      <Button
        variant="ghost"
        size="icon"
        className={navBtnClass}
        onClick={() => cycleProtocol(-1)}
        title="Previous hanging protocol"
        data-cy="hanging-protocol-prev"
      >
        <Icons.ChevronLeft />
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className={`border-inputfield-main focus:border-inputfield-main flex items-center justify-between rounded border bg-black text-white hover:bg-gray-800 ${
              isCompact
                ? 'h-[24px] min-w-[4.5rem] max-w-[5.75rem] px-1 text-[10px]'
                : 'h-[26px] min-w-[88px] px-2 text-sm'
            }`}
            data-cy="hanging-protocol-dropdown-trigger"
            title="Hanging protocol"
          >
            <span className="truncate">{currentProtocol}</span>
            <span className={`text-white/70 ${isCompact ? 'ml-1 text-[8px]' : 'ml-2 text-xs'}`}>
              ▼
            </span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="bg-popover min-w-[88px]"
        >
          {protocolOptions.map(option => {
            const isActive = currentProtocolId === option.protocolId;
            return (
              <DropdownMenuItem
                key={option.id}
                className={`cursor-pointer text-white ${
                  isActive ? 'bg-gray-700 font-bold' : 'hover:bg-gray-700'
                }`}
                onClick={() => handleProtocolChange(option)}
                data-cy={`hanging-protocol-option-${option.id}`}
              >
                {option.label}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
      <Button
        variant="ghost"
        size="icon"
        className={navBtnClass}
        onClick={() => cycleProtocol(1)}
        title="Next hanging protocol"
        data-cy="hanging-protocol-next"
      >
        <Icons.ChevronRight />
      </Button>
    </div>
  );
}

HangingProtocolSelectorWithServices.propTypes = {
  commandsManager: PropTypes.instanceOf(CommandsManager).isRequired,
  servicesManager: PropTypes.object.isRequired,
};

export default HangingProtocolSelectorWithServices;
