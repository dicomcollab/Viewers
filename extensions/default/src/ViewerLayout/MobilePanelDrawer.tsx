import React, { ReactNode, useEffect } from 'react';
import './MobilePanelDrawer.css';

type MobilePanelDrawerProps = {
  side: 'left' | 'right';
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  /** CSS top offset so the drawer sits below the header (px). */
  topOffsetPx?: number;
};

/**
 * Slide-over panel (~85% width) with dimmed backdrop for mobile/tablet layout.
 * Hosts the existing SidePanel content; does not replace panel tab logic.
 */
function MobilePanelDrawer({
  side,
  open,
  onClose,
  children,
  topOffsetPx = 44,
}: MobilePanelDrawerProps): ReactNode {
  useEffect(() => {
    if (!open) {
      return;
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  return (
    <div
      className={`ohif-mobile-drawer-root ${open ? 'ohif-mobile-drawer-root--open' : ''}`}
      aria-hidden={!open}
    >
      <button
        type="button"
        className="ohif-mobile-drawer-backdrop"
        aria-label="Close panel"
        tabIndex={open ? 0 : -1}
        onClick={onClose}
      />
      <div
        className={`ohif-mobile-drawer-panel ohif-mobile-drawer-panel--${side} ${
          open ? 'ohif-mobile-drawer-panel--open' : ''
        }`}
        style={{ top: topOffsetPx }}
        role="dialog"
        aria-modal="true"
      >
        {children}
      </div>
    </div>
  );
}

export default MobilePanelDrawer;
