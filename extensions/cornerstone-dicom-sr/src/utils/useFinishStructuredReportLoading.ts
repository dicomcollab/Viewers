import { useEffect } from 'react';
import { utils } from '@ohif/core';

/**
 * Clears the pending SR loading overlay once this SR has been placed in its final viewport
 * and its content is painted. Waits two frames so the DOM/canvas is visible before hiding.
 */
export function useFinishStructuredReportLoading(
  displaySetInstanceUID: string | undefined,
  isRendered: boolean
): void {
  useEffect(() => {
    if (!displaySetInstanceUID || !isRendered) {
      return;
    }

    let frameA: number | null = null;
    let frameB: number | null = null;

    const tryFinish = () => {
      const pending = utils.getStructuredReportLoading();
      if (
        !pending ||
        pending.phase !== 'assigned' ||
        (pending.displaySetInstanceUID && pending.displaySetInstanceUID !== displaySetInstanceUID)
      ) {
        return;
      }
      if (frameA !== null) {
        return;
      }
      frameA = requestAnimationFrame(() => {
        frameB = requestAnimationFrame(() => {
          utils.finishStructuredReportLoading(displaySetInstanceUID);
          frameA = null;
          frameB = null;
        });
      });
    };

    tryFinish();
    const unsubscribe = utils.subscribeStructuredReportLoading(tryFinish);

    return () => {
      unsubscribe();
      if (frameA !== null) {
        cancelAnimationFrame(frameA);
      }
      if (frameB !== null) {
        cancelAnimationFrame(frameB);
      }
    };
  }, [displaySetInstanceUID, isRendered]);
}
