import {
  BaseRenderingEngine,
  ContextPoolRenderingEngine,
  TiledRenderingEngine,
} from '@cornerstonejs/core';
import { isOutOfMemoryError, relieveMemoryPressure, scheduleMemoryRestore } from './memoryPressure';

/**
 * Cornerstone renders flagged viewports in one requestAnimationFrame callback and
 * only clears `_animationFrameSet` after every viewport rendered. If one tile
 * throws (e.g. "Array buffer allocation failed" while vtk uploads a texture) the
 * flag stays set, no frame is ever scheduled again and every tile freezes until
 * the page is reloaded. Here a failing tile is skipped and re-rendered later, and
 * a stale flag is cleared so the loop always recovers.
 */

type ViewportLike = { id?: string };

type EngineImpl = {
  hasBeenDestroyed?: boolean;
  _viewports?: Map<string, unknown>;
  _animationFrameSet?: boolean;
  _animationFrameHandle?: number | null;
  _setViewportsToBeRenderedNextFrame?: (viewportIds: string[]) => void;
  __ohifRenderRetries?: Map<string, number>;
  __ohifFrameRequestedAt?: number;
};

type EnginePrototype = Record<string, unknown> & { __ohifRenderGuarded?: boolean };

const RETRY_BASE_DELAY_MS = 250;
const RETRY_MAX_DELAY_MS = 4000;
/** A requested animation frame that has not run for this long (tab visible) is stale. */
const STALLED_FRAME_MS = 1000;
const LOG_INTERVAL_MS = 2000;

let lastLoggedAt = 0;

function logRenderError(error: unknown): void {
  const now = Date.now();
  if (now - lastLoggedAt < LOG_INTERVAL_MS) {
    return;
  }
  lastLoggedAt = now;
  console.warn('[renderLoopGuard] Viewport render failed, retrying:', error);
}

function scheduleViewportRetry(engine: EngineImpl, viewportId: string): void {
  engine.__ohifRenderRetries ??= new Map();
  const attempt = engine.__ohifRenderRetries.get(viewportId) ?? 0;
  engine.__ohifRenderRetries.set(viewportId, attempt + 1);
  const delay = Math.min(RETRY_MAX_DELAY_MS, RETRY_BASE_DELAY_MS * 2 ** attempt);

  setTimeout(() => {
    if (engine.hasBeenDestroyed || !engine._viewports?.has(viewportId)) {
      return;
    }
    try {
      engine._setViewportsToBeRenderedNextFrame?.([viewportId]);
    } catch {
      // Engine torn down meanwhile.
    }
  }, delay);
}

function onRenderError(
  engine: EngineImpl,
  viewport: ViewportLike | undefined,
  error: unknown
): void {
  if (engine.hasBeenDestroyed) {
    return;
  }
  logRenderError(error);

  if (isOutOfMemoryError(error)) {
    relieveMemoryPressure('render');
  }
  // A tile whose image buffer could not be allocated has no pixels to draw; re-bind it.
  scheduleMemoryRestore();

  if (viewport?.id) {
    scheduleViewportRetry(engine, viewport.id);
  }
}

function guardMethod(proto: EnginePrototype, name: string, takesViewport: boolean): void {
  const original = proto[name];
  if (typeof original !== 'function') {
    return;
  }

  proto[name] = function (this: EngineImpl, ...args: unknown[]) {
    const viewport = takesViewport ? (args[0] as ViewportLike | undefined) : undefined;
    try {
      const result = original.apply(this, args);
      if (viewport?.id) {
        this.__ohifRenderRetries?.delete(viewport.id);
      }
      return result;
    } catch (error) {
      onRenderError(this, viewport, error);
      return undefined;
    }
  };
}

function guardRenderScheduling(proto: EnginePrototype): void {
  const original = proto._render;
  if (typeof original !== 'function') {
    return;
  }

  proto._render = function (this: EngineImpl) {
    const requestedAt = this.__ohifFrameRequestedAt ?? 0;
    if (
      this._animationFrameSet &&
      document.visibilityState === 'visible' &&
      performance.now() - requestedAt > STALLED_FRAME_MS
    ) {
      if (this._animationFrameHandle != null) {
        window.cancelAnimationFrame(this._animationFrameHandle);
      }
      this._animationFrameSet = false;
      this._animationFrameHandle = null;
    }

    const wasRequested = this._animationFrameSet;
    const result = (original as () => unknown).call(this);
    if (!wasRequested && this._animationFrameSet) {
      this.__ohifFrameRequestedAt = performance.now();
    }
    return result;
  };
}

export function installRenderLoopGuard(): void {
  const base = (BaseRenderingEngine as unknown as { prototype?: EnginePrototype })?.prototype;
  if (!base || base.__ohifRenderGuarded) {
    return;
  }
  base.__ohifRenderGuarded = true;

  guardRenderScheduling(base);

  [ContextPoolRenderingEngine, TiledRenderingEngine].forEach(EngineClass => {
    const proto = (EngineClass as unknown as { prototype?: EnginePrototype })?.prototype;
    if (!proto) {
      return;
    }
    guardMethod(proto, 'renderViewportUsingCustomOrVtkPipeline', true);
    if (Object.prototype.hasOwnProperty.call(proto, 'performVtkDrawCall')) {
      guardMethod(proto, 'performVtkDrawCall', false);
    }
  });
}
