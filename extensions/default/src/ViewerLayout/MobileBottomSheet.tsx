import React, { ReactNode, useEffect, useRef, useState } from 'react';
import './MobileBottomSheet.css';

export type MobileSheetSnap = 'peek' | 'half' | 'full';

type MobileBottomSheetProps = {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  /** Initial snap when opened. Default half. */
  initialSnap?: MobileSheetSnap;
  headerActions?: ReactNode;
};

const SNAP_HEIGHT: Record<MobileSheetSnap, string> = {
  peek: '25vh',
  half: '50vh',
  full: '90vh',
};

/**
 * Mobile bottom sheet with peek / half / full snap points.
 * Drag the handle or swipe down to dismiss.
 */
function MobileBottomSheet({
  open,
  onClose,
  title,
  children,
  initialSnap = 'half',
  headerActions,
}: MobileBottomSheetProps): ReactNode {
  const [snap, setSnap] = useState<MobileSheetSnap>(initialSnap);
  const dragStartY = useRef<number | null>(null);
  const dragDelta = useRef(0);

  useEffect(() => {
    if (open) {
      setSnap(initialSnap);
    }
  }, [open, initialSnap]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const cycleSnapUp = () => {
    setSnap(s => (s === 'peek' ? 'half' : s === 'half' ? 'full' : 'full'));
  };

  const onHandlePointerDown = (e: React.PointerEvent) => {
    dragStartY.current = e.clientY;
    dragDelta.current = 0;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };

  const onHandlePointerMove = (e: React.PointerEvent) => {
    if (dragStartY.current == null) {
      return;
    }
    dragDelta.current = e.clientY - dragStartY.current;
  };

  const onHandlePointerUp = () => {
    if (dragStartY.current == null) {
      return;
    }
    const delta = dragDelta.current;
    dragStartY.current = null;
    if (delta > 80) {
      if (snap === 'full') {
        setSnap('half');
      } else if (snap === 'half') {
        setSnap('peek');
      } else {
        onClose();
      }
      return;
    }
    if (delta < -80) {
      cycleSnapUp();
    }
  };

  return (
    <div
      className={`ohif-mobile-sheet-root ${open ? 'ohif-mobile-sheet-root--open' : ''}`}
      aria-hidden={!open}
    >
      <button
        type="button"
        className="ohif-mobile-sheet-backdrop"
        aria-label="Close sheet"
        tabIndex={open ? 0 : -1}
        onClick={onClose}
      />
      <div
        className={`ohif-mobile-sheet-panel ${open ? 'ohif-mobile-sheet-panel--open' : ''}`}
        style={{ height: SNAP_HEIGHT[snap] }}
        role="dialog"
        aria-modal="true"
        aria-label={title || 'Panel'}
      >
        <div
          className="ohif-mobile-sheet-handle-row"
          onPointerDown={onHandlePointerDown}
          onPointerMove={onHandlePointerMove}
          onPointerUp={onHandlePointerUp}
          onPointerCancel={onHandlePointerUp}
        >
          <div className="ohif-mobile-sheet-handle" />
        </div>
        {(title || headerActions) && (
          <div className="ohif-mobile-sheet-header">
            <div className="ohif-mobile-sheet-title">{title}</div>
            {headerActions ? (
              <div className="ohif-mobile-sheet-header-actions">{headerActions}</div>
            ) : null}
          </div>
        )}
        <div className="ohif-mobile-sheet-body">{children}</div>
      </div>
    </div>
  );
}

export default MobileBottomSheet;
