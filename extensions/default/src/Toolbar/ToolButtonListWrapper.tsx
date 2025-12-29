import React from 'react';
import {
  ToolButtonList,
  ToolButton,
  ToolButtonListDefault,
  ToolButtonListDropDown,
  ToolButtonListItem,
  ToolButtonListDivider,
} from '@ohif/ui-next';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent } from '@ohif/ui-next';
import { useToolbar } from '@ohif/core/src';

interface ToolButtonListWrapperProps {
  buttonSection: string;
  onInteraction?: (details: { itemId: string; commands?: Record<string, unknown> }) => void;
  id: string;
}

/**
 * Wraps the ToolButtonList component to handle the OHIF toolbar button structure
 * @param props - Component props
 * @returns Component
 * // test
 */
export default function ToolButtonListWrapper({ buttonSection, id }: ToolButtonListWrapperProps) {
  const { onInteraction, toolbarButtons } = useToolbar({
    buttonSection,
  });

  if (!toolbarButtons?.length) {
    return null;
  }

  // For MoreTools, always use ellipsis icon instead of first tool
  const isMoreTools = id === 'MoreTools';

  const items = toolbarButtons.map(button => button.componentProps);

  // For MoreTools, create a simple dropdown button without split button structure
  if (isMoreTools) {
    const moreButtonProps = {
      icon: 'More',
      label: 'More',
      tooltip: 'More Tools',
      id: 'MoreTools',
    };

    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <div data-cy={`${id}-button`}>
            <ToolButton
              {...moreButtonProps}
              onInteraction={() => {
                // No command execution, just opens dropdown
              }}
            />
          </div>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {items.map(item => {
            return (
              <ToolButtonListItem
                key={item.id}
                {...item}
                data-cy={item.id}
                data-tool={item.id}
                data-active={item.isActive}
                onSelect={() => onInteraction?.({ id, itemId: item.id, commands: item.commands })}
              >
                <span className="pl-1">{item.label || item.tooltip || item.id}</span>
              </ToolButtonListItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  // For other tool sections, use the standard split button structure
  const primary =
    toolbarButtons.find(button => button.componentProps.isActive)?.componentProps ||
    toolbarButtons[0].componentProps;

  return (
    <ToolButtonList>
      <ToolButtonListDefault>
        <div
          data-cy={`${id}-split-button-primary`}
          data-tool={primary.id}
          data-active={primary.isActive}
        >
          <ToolButton
            {...primary}
            onInteraction={({ itemId }) => {
              onInteraction?.({ id, itemId, commands: primary.commands });
            }}
            className={primary.className}
          />
        </div>
      </ToolButtonListDefault>
      <ToolButtonListDivider className={primary.isActive ? 'opacity-0' : 'opacity-100'} />
      <div data-cy={`${id}-split-button-secondary`}>
        <ToolButtonListDropDown>
          {items.map(item => {
            return (
              <ToolButtonListItem
                key={item.id}
                {...item}
                data-cy={item.id}
                data-tool={item.id}
                data-active={item.isActive}
                onSelect={() => onInteraction?.({ id, itemId: item.id, commands: item.commands })}
              >
                <span className="pl-1">{item.label || item.tooltip || item.id}</span>
              </ToolButtonListItem>
            );
          })}
        </ToolButtonListDropDown>
      </div>
    </ToolButtonList>
  );
}
