import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Icons } from '@ohif/ui-next';

import { getToolIconName } from './getToolIconName';
import './ActiveToolCursorOverlay.css';

interface ActiveToolCursorOverlayProps {
  viewportId: string;
  element: HTMLElement | null;
  servicesManager: AppTypes.ServicesManager;
}

type PreferencesWithToolCursor = {
  showToolCursor?: boolean | string | null;
};

const ICON_OFFSET_PX = 14;

/** Strict opt-in: only true/'true'. Missing / older RIS / errors → false. */
function isShowToolCursorEnabled(value: unknown): boolean {
  return value === true || value === 'true';
}

function ActiveToolCursorOverlay({
  viewportId,
  element,
  servicesManager,
}: ActiveToolCursorOverlayProps) {
  const { toolGroupService, toolbarService } = servicesManager.services;
  const badgeRef = useRef<HTMLDivElement>(null);
  // Default OFF so viewer-only deploys (or older RIS without this pref) never show the icon.
  const [enabled, setEnabled] = useState(false);
  const [activeToolName, setActiveToolName] = useState<string | undefined>(() =>
    toolGroupService.getActiveToolForViewport(viewportId)
  );

  useEffect(() => {
    let cancelled = false;

    const applyPrefs = (prefs: PreferencesWithToolCursor | null | undefined) => {
      if (cancelled) {
        return;
      }
      // Missing field from older RIS → false.
      setEnabled(isShowToolCursorEnabled(prefs?.showToolCursor));
    };

    applyPrefs(
      (window as Window & { getPreferencesFromCookies?: () => PreferencesWithToolCursor | null })
        .getPreferencesFromCookies?.() || null
    );

    const fetchPreferences = (
      window as Window & {
        fetchPreferences?: () => Promise<PreferencesWithToolCursor | null>;
      }
    ).fetchPreferences;

    if (typeof fetchPreferences === 'function') {
      fetchPreferences()
        .then(prefs => {
          applyPrefs(prefs);
        })
        .catch(() => {
          if (!cancelled) {
            setEnabled(false);
          }
        });
    }

    return () => {
      cancelled = true;
    };
  }, []);

  const updateActiveTool = useCallback(() => {
    setActiveToolName(toolGroupService.getActiveToolForViewport(viewportId));
  }, [toolGroupService, viewportId]);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    updateActiveTool();

    const { unsubscribe: unsubscribePrimaryTool } = toolGroupService.subscribe(
      toolGroupService.EVENTS.PRIMARY_TOOL_ACTIVATED,
      updateActiveTool
    );

    const { unsubscribe: unsubscribeToolActivated } = toolGroupService.subscribe(
      toolGroupService.EVENTS.TOOL_ACTIVATED,
      updateActiveTool
    );

    const { unsubscribe: unsubscribeToolbar } = toolbarService.subscribe(
      toolbarService.EVENTS.TOOL_BAR_STATE_MODIFIED,
      updateActiveTool
    );

    return () => {
      unsubscribePrimaryTool();
      unsubscribeToolActivated();
      unsubscribeToolbar();
    };
  }, [enabled, toolGroupService, toolbarService, updateActiveTool]);

  const iconName = enabled ? getToolIconName(activeToolName, toolbarService) : undefined;

  useEffect(() => {
    const badge = badgeRef.current;
    if (!enabled || !element || !badge || !iconName) {
      return;
    }

    let frameId: number | null = null;
    let rect: DOMRect | null = null;
    let lastX = 0;
    let lastY = 0;

    const applyPosition = () => {
      frameId = null;
      badge.style.transform = `translate3d(${lastX + ICON_OFFSET_PX}px, ${lastY + ICON_OFFSET_PX}px, 0)`;
    };

    const onPointerMove = (event: PointerEvent) => {
      if (!rect) {
        rect = element.getBoundingClientRect();
      }

      lastX = event.clientX - rect.left;
      lastY = event.clientY - rect.top;

      if (badge.style.visibility !== 'visible') {
        badge.style.visibility = 'visible';
      }

      if (frameId === null) {
        frameId = requestAnimationFrame(applyPosition);
      }
    };

    const onPointerEnter = (event: PointerEvent) => {
      rect = element.getBoundingClientRect();
      onPointerMove(event);
    };

    const onPointerLeave = () => {
      rect = null;
      badge.style.visibility = 'hidden';
    };

    element.addEventListener('pointerenter', onPointerEnter, { passive: true });
    element.addEventListener('pointermove', onPointerMove, { passive: true });
    element.addEventListener('pointerleave', onPointerLeave, { passive: true });

    return () => {
      element.removeEventListener('pointerenter', onPointerEnter);
      element.removeEventListener('pointermove', onPointerMove);
      element.removeEventListener('pointerleave', onPointerLeave);
      if (frameId !== null) {
        cancelAnimationFrame(frameId);
      }
      badge.style.visibility = 'hidden';
    };
  }, [enabled, element, iconName]);

  if (!enabled || !element || !iconName) {
    return null;
  }

  return (
    <div
      ref={badgeRef}
      className="active-tool-cursor"
      data-tool={activeToolName}
      aria-hidden="true"
    >
      <Icons.ByName name={iconName} />
    </div>
  );
}

export default ActiveToolCursorOverlay;
