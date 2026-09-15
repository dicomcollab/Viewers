import { eventTarget, EVENTS } from '@cornerstonejs/core';
import { isUsFrameDistributionEnabled } from '@ohif/extension-default';
import { getCineDisplaySetFromViewport, isUsMultiframeDisplaySet } from './cineSyncUtils';
import { getAliveViewport, getViewportFrameIndex, setViewportFrameIndex } from './safeViewportFrameUtils';
import { getUsLayoutViewportIds } from './usGridViewportUtils';
import { isStackFrameReady, prefetchStackFrame } from './cineFrameLoadUtils';
import {
  resolveUsInstanceInitialFrameIndex,
  saveUsInstanceFrame,
} from './usInstanceFrameStateStore';

const pendingRestoreByViewport = new Map<string, { frameIndex: number; timers: number[] }>();

function shouldTrackUsInstanceFrames(): boolean {
  try {
    return !isUsFrameDistributionEnabled();
  } catch {
    return true;
  }
}

function getUsDisplaySetForViewport(
  servicesManager: AppTypes.ServicesManager,
  viewportId: string
) {
  const { displaySetService, viewportGridService } = servicesManager.services;
  const viewportState = viewportGridService.getState()?.viewports?.get(viewportId);

  return getCineDisplaySetFromViewport(displaySetService, viewportState);
}

function rememberUsViewportFrame(
  servicesManager: AppTypes.ServicesManager,
  viewportId: string,
  frameIndex?: number
): void {
  if (!shouldTrackUsInstanceFrames() || !viewportId || pendingRestoreByViewport.has(viewportId)) {
    return;
  }

  const displaySet = getUsDisplaySetForViewport(servicesManager, viewportId);

  if (!isUsMultiframeDisplaySet(displaySet)) {
    return;
  }

  const viewport = getAliveViewport(
    servicesManager.services.cornerstoneViewportService,
    viewportId
  );
  const index = frameIndex ?? getViewportFrameIndex(viewport);

  saveUsInstanceFrame(displaySet, index);
}

function snapshotUsLayoutInstanceFrames(servicesManager: AppTypes.ServicesManager): void {
  if (!shouldTrackUsInstanceFrames()) {
    return;
  }

  getUsLayoutViewportIds(servicesManager).forEach(viewportId => {
    rememberUsViewportFrame(servicesManager, viewportId);
  });
}

function resolveUsStackInitialImageIndex(displaySet, frameCount?: number): number | null {
  if (!shouldTrackUsInstanceFrames() || !isUsMultiframeDisplaySet(displaySet)) {
    return null;
  }

  return resolveUsInstanceInitialFrameIndex(displaySet, frameCount);
}

function clearPendingUsInstanceFrameRestore(viewportId: string): void {
  const pending = pendingRestoreByViewport.get(viewportId);

  if (!pending) {
    return;
  }

  pending.timers.forEach(timerId => window.clearTimeout(timerId));
  pendingRestoreByViewport.delete(viewportId);
}

function scheduleUsInstanceFrameRestore(
  servicesManager: AppTypes.ServicesManager,
  viewportId: string,
  frameIndex: number
): void {
  if (!shouldTrackUsInstanceFrames() || !viewportId || !Number.isFinite(frameIndex)) {
    return;
  }

  clearPendingUsInstanceFrameRestore(viewportId);

  const delays = [0, 80, 250, 700, 1600];
  const timers: number[] = [];

  delays.forEach((ms, attempt) => {
    const timerId = window.setTimeout(() => {
      const isLast = attempt === delays.length - 1;
      const displaySet = getUsDisplaySetForViewport(servicesManager, viewportId);

      if (!isUsMultiframeDisplaySet(displaySet)) {
        if (isLast) {
          pendingRestoreByViewport.delete(viewportId);
        }
        return;
      }

      const viewport = getAliveViewport(
        servicesManager.services.cornerstoneViewportService,
        viewportId
      );

      if (!viewport) {
        if (isLast) {
          pendingRestoreByViewport.delete(viewportId);
        }
        return;
      }

      const imageIds = typeof viewport.getImageIds === 'function' ? viewport.getImageIds() ?? [] : [];
      const clamped = Math.max(0, Math.min(Math.max(0, imageIds.length - 1), Math.round(frameIndex)));
      const ready = isStackFrameReady(imageIds[clamped]);

      if (!ready) {
        prefetchStackFrame(imageIds[clamped]);

        if (!isLast) {
          return;
        }
      }

      // After setStack has bound a cached frame, jumping via setImageIdIndex is
      // safe even if the saved frame is still downloading.
      setViewportFrameIndex(viewport, clamped);

      if (ready || isLast) {
        pendingRestoreByViewport.delete(viewportId);
      }
    }, ms);

    timers.push(timerId);
  });

  pendingRestoreByViewport.set(viewportId, { frameIndex, timers });
}

function initUsInstanceFrameState(servicesManager: AppTypes.ServicesManager): void {
  const onStackFrame = (evt: Event) => {
    const viewportId = (evt as CustomEvent)?.detail?.viewportId;

    if (!viewportId) {
      return;
    }

    rememberUsViewportFrame(servicesManager, viewportId);
  };

  eventTarget.addEventListener(EVENTS.STACK_NEW_IMAGE, onStackFrame);
  eventTarget.addEventListener(EVENTS.STACK_VIEWPORT_SCROLL, onStackFrame);
}

export {
  initUsInstanceFrameState,
  rememberUsViewportFrame,
  resolveUsStackInitialImageIndex,
  scheduleUsInstanceFrameRestore,
  snapshotUsLayoutInstanceFrames,
};
