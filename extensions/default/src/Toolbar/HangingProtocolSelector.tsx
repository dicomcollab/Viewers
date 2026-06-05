import React, { useState, useEffect, useCallback } from 'react';
import PropTypes from 'prop-types';
import { CommandsManager } from '@ohif/core';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@ohif/ui-next';
import { useTranslation } from 'react-i18next';

interface HangingProtocolSelectorProps {
  commandsManager: CommandsManager;
  servicesManager: any;
}

function HangingProtocolSelectorWithServices({
  commandsManager,
  servicesManager,
}: HangingProtocolSelectorProps) {
  const { hangingProtocolService } = servicesManager.services;
  const { t } = useTranslation('HangingProtocolSelector');

  const [currentProtocol, setCurrentProtocol] = useState<string>('ALL | 1×1');
  const [currentProtocolId, setCurrentProtocolId] = useState<string | null>(null);

  // Define the protocol options
  const protocolOptions = [
    { id: 'allModality1x1', label: 'ALL | 1×1', protocolId: 'allModality1x1', stageId: '1x1' },
    { id: 'allModality1x2', label: 'ALL | 1×2', protocolId: 'allModality1x2', stageId: '1x2' },
    { id: 'allModality1x4', label: 'ALL | 1×4', protocolId: 'allModality1x4', stageId: '1x4' },
    {
      id: 'allModalityCompare2x1',
      label: 'ALL | Compare 2×1',
      protocolId: 'allModalityCompare2x1',
      stageId: 'compare2x1',
    },
  ];

  // Update current protocol based on hanging protocol service state
  useEffect(() => {
    const updateCurrentProtocol = () => {
      const hpState = hangingProtocolService.getState();
      const protocolId = hpState?.protocolId;

      if (protocolId) {
        const option = protocolOptions.find(opt => opt.protocolId === protocolId);
        if (option) {
          setCurrentProtocol(option.label);
          setCurrentProtocolId(protocolId);
        } else {
          // If it's not one of our protocols (e.g., 'default'),
          // try to match by layout structure or default to 1×1
          const { viewportGridService } = servicesManager.services;
          if (viewportGridService) {
            const gridState = viewportGridService.getState();
            const layout = gridState?.layout;

            // Try to match layout structure to our protocols
            if (layout) {
              const { numRows, numCols } = layout;
              if (numRows === 1 && numCols === 1) {
                setCurrentProtocol('ALL | 1×1');
                setCurrentProtocolId('allModality1x1');
              } else if (numRows === 1 && numCols === 2) {
                setCurrentProtocol('ALL | 1×2');
                setCurrentProtocolId('allModality1x2');
              } else if (numRows === 2 && numCols === 2) {
                setCurrentProtocol('ALL | 1×4');
                setCurrentProtocolId('allModality1x4');
              } else if (numRows === 2 && numCols === 1) {
                setCurrentProtocol('ALL | Compare 2×1');
                setCurrentProtocolId('allModalityCompare2x1');
              } else {
                // Default to 1×1 if layout doesn't match
                setCurrentProtocol('ALL | 1×1');
                setCurrentProtocolId(null);
              }
            } else {
              // Default to 1×1 if no layout info
              setCurrentProtocol('ALL | 1×1');
              setCurrentProtocolId(null);
            }
          } else {
            // Default to 1×1 if viewportGridService not available
            setCurrentProtocol('ALL | 1×1');
            setCurrentProtocolId(null);
          }
        }
      } else {
        // No protocol set, default to 1×1
        setCurrentProtocol('ALL | 1×1');
        setCurrentProtocolId(null);
      }
    };

    // Initial update with a small delay to ensure services are ready
    const timeoutId = setTimeout(updateCurrentProtocol, 100);
    updateCurrentProtocol();

    // Subscribe to protocol changes (service returns { unsubscribe } or cleanup may be called when service is reset)
    const subscription = hangingProtocolService.subscribe(
      hangingProtocolService.EVENTS.PROTOCOL_CHANGED,
      updateCurrentProtocol
    );
    const unsubscribeFn =
      typeof subscription?.unsubscribe === 'function'
        ? subscription.unsubscribe
        : typeof subscription === 'function'
          ? subscription
          : undefined;

    return () => {
      clearTimeout(timeoutId);
      if (typeof unsubscribeFn === 'function') {
        unsubscribeFn();
      }
    };
  }, [hangingProtocolService, servicesManager]);

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
    },
    [commandsManager]
  );

  return (
    <div
      className="mr-4 flex items-center gap-2"
      id="HangingProtocol"
      data-cy="HangingProtocol"
    >
      <span className="whitespace-nowrap text-sm text-white">Hanging Protocol</span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className="border-inputfield-main focus:border-inputfield-main flex h-[26px] min-w-[120px] items-center justify-between rounded border bg-black px-2 text-sm text-white hover:bg-gray-800"
            data-cy="hanging-protocol-dropdown-trigger"
          >
            <span className="truncate">{currentProtocol}</span>
            <span className="ml-2 text-xs">▼</span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="bg-popover min-w-[120px]"
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
    </div>
  );
}

HangingProtocolSelectorWithServices.propTypes = {
  commandsManager: PropTypes.instanceOf(CommandsManager).isRequired,
  servicesManager: PropTypes.object.isRequired,
};

export default HangingProtocolSelectorWithServices;
