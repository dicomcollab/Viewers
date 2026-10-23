import React from 'react';
import { useSystem, useToolbar } from '@ohif/core';

/**
 * Entry placed in a button section's id list to start a new visual group when the
 * toolbar is rendered with `grouped`, e.g. `['Pan', 'Zoom', '|', 'Layout']`.
 */
export const TOOLBAR_GROUP_SEPARATOR = '|';

/**
 * Props for the Toolbar component that renders a collection of toolbar buttons and/or button sections.
 *
 * @interface ToolbarProps
 */
interface ToolbarProps {
  /**
   * The section of buttons to display in the toolbar.
   * Common values include 'primary', 'secondary', 'tertiary', etc.
   * Defaults to 'primary' if not specified.
   *
   * @default 'primary'
   */
  buttonSection?: string;

  /**
   * The unique identifier of the viewport this toolbar is associated with.
   */
  viewportId?: string;

  /**
   * The numeric position or location of the toolbar.
   * Used for ordering and layout purposes in the UI.
   */
  location?: number;

  /**
   * Wrap buttons in pill containers, split at `TOOLBAR_GROUP_SEPARATOR` entries of the section.
   */
  grouped?: boolean;
}

export function Toolbar({
  buttonSection = 'primary',
  viewportId,
  location,
  grouped = false,
}: ToolbarProps) {
  const { servicesManager } = useSystem();
  const {
    toolbarButtons,
    onInteraction,
    isItemOpen,
    isItemLocked,
    openItem,
    closeItem,
    toggleLock,
  } = useToolbar({
    buttonSection,
  });

  if (!toolbarButtons.length) {
    return null;
  }

  const renderTool = toolDef => {
    if (!toolDef) {
      return null;
    }

    const { id, Component, componentProps } = toolDef;

    // Enhanced props with state and actions - respecting viewport specificity
    const enhancedProps = {
      ...componentProps,
      isOpen: isItemOpen(id, viewportId),
      isLocked: isItemLocked(id, viewportId),
      onOpen: () => openItem(id, viewportId),
      onClose: () => closeItem(id, viewportId),
      onToggleLock: () => toggleLock(id, viewportId),
      viewportId,
    };

    const tool = (
      <Component
        key={id}
        id={id}
        location={location}
        onInteraction={args => {
          onInteraction({
            ...args,
            itemId: id,
            viewportId,
          });
        }}
        {...enhancedProps}
      />
    );

    return (
      <div
        key={id}
        // This wrapper div exists solely for React's key prop requirement during reconciliation.
        // We use display:contents to make it transparent to the layout engine (children appear
        // as direct children of the parent) while keeping it in the DOM for React's virtual DOM.
        className="contents"
      >
        {tool}
      </div>
    );
  };

  if (!grouped) {
    return <>{toolbarButtons.map(renderTool)}</>;
  }

  const sectionIds: string[] =
    servicesManager.services.toolbarService.state.buttonSections[buttonSection] || [];
  const toolDefsById = new Map(toolbarButtons.map(toolDef => [toolDef.id, toolDef]));

  const groups: string[][] = [[]];
  sectionIds.forEach(sectionId => {
    if (sectionId === TOOLBAR_GROUP_SEPARATOR) {
      groups.push([]);
    } else if (toolDefsById.has(sectionId)) {
      groups[groups.length - 1].push(sectionId);
    }
  });

  return (
    <>
      {groups
        .filter(group => group.length)
        .map(group => (
          <div
            key={group.join('-')}
            className="ohif-toolbar-group"
            data-cy="toolbar-group"
          >
            {group.map(toolId => renderTool(toolDefsById.get(toolId)))}
          </div>
        ))}
    </>
  );
}
