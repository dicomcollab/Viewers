import React, { ReactNode, useMemo } from 'react';
import { IconPresentationProvider } from '@ohif/ui-next';
import { useToolbar } from '@ohif/core';
import './MobileBottomToolbar.css';

type MobileBottomToolbarProps = {
  onOpenMore?: () => void;
  onOpenKeyImages?: () => void;
};

/** Hard cap — never show a scrollable desktop tool row on mobile. */
const MOBILE_PRIMARY_ORDER = [
  'WindowLevel',
  'Pan',
  'Zoom',
  'MeasurementTools',
  'AddKeyImage',
  'MoreTools',
] as const;

const SHORT_LABEL: Record<string, string> = {
  WindowLevel: 'W/L',
  Pan: 'Pan',
  Zoom: 'Zoom',
  MeasurementTools: 'Measure',
  MoreTools: 'More',
  AddKeyImage: 'Key',
};

/**
 * Labeled mobile bottom tool bar: exactly the essentials, no horizontal scroll.
 */
function MobileBottomToolbar({
  onOpenMore,
  onOpenKeyImages,
}: MobileBottomToolbarProps): ReactNode {
  const { toolbarButtons, onInteraction, isItemOpen, isItemLocked, openItem, closeItem, toggleLock } =
    useToolbar({ buttonSection: 'primary' });

  const visibleButtons = useMemo(() => {
    const byId = new Map((toolbarButtons || []).filter(Boolean).map(b => [b.id, b]));
    return MOBILE_PRIMARY_ORDER.map(id => byId.get(id)).filter(Boolean);
  }, [toolbarButtons]);

  if (!visibleButtons.length) {
    return null;
  }

  return (
    <div
      className="ohif-mobile-bottom-toolbar"
      data-cy="mobile-bottom-toolbar"
    >
      <IconPresentationProvider size={22}>
        <div className="ohif-mobile-bottom-toolbar__row">
          {visibleButtons.map(toolDef => {
            const { id, Component, componentProps } = toolDef;
            if (!Component) {
              return null;
            }

            const isActive = Boolean(componentProps?.isActive);
            const disabled = Boolean(componentProps?.disabled);
            const caption = SHORT_LABEL[id] || String(componentProps?.label || id).slice(0, 8);

            const enhancedProps = {
              ...componentProps,
              isOpen: isItemOpen?.(id),
              isLocked: isItemLocked?.(id),
              onOpen: () => openItem?.(id),
              onClose: () => closeItem?.(id),
              onToggleLock: () => toggleLock?.(id),
            };

            return (
              <div
                key={id}
                className={`ohif-mobile-tool ${isActive ? 'is-active' : ''} ${disabled ? 'is-disabled' : ''}`}
                onClickCapture={
                  id === 'AddKeyImage' && onOpenKeyImages
                    ? e => {
                        e.preventDefault();
                        e.stopPropagation();
                        onOpenKeyImages();
                      }
                    : id === 'MoreTools' && onOpenMore
                      ? e => {
                          // Open tools sheet instead of tiny desktop overflow when possible
                          e.preventDefault();
                          e.stopPropagation();
                          onOpenMore();
                        }
                      : undefined
                }
              >
                <span className="ohif-mobile-tool__icon">
                  <Component
                    id={id}
                    onInteraction={args => {
                      if (id === 'AddKeyImage' && onOpenKeyImages) {
                        onOpenKeyImages();
                        return;
                      }
                      if (id === 'MoreTools' && onOpenMore) {
                        onOpenMore();
                        return;
                      }
                      onInteraction({
                        ...args,
                        itemId: id,
                      });
                    }}
                    {...enhancedProps}
                  />
                </span>
                <span className="ohif-mobile-tool__label">{caption}</span>
              </div>
            );
          })}
        </div>
      </IconPresentationProvider>
    </div>
  );
}

export default MobileBottomToolbar;
