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

type ContextPoolLike = {
  getContextIndexForViewport: (viewportId: string) => number | undefined;
  updateViewportSize: (viewportId: string, width: number, height: number) => boolean;
  getMaxSizeForContext: (contextIndex: number) => { width: number; height: number } | undefined;
};

/**
 * WebGLContextPool.removeViewport (every tile re-enable on a page change) recomputes the
 * context's max size without resizing its offscreen canvas, and the engine only resizes
 * when the max size changes. The canvas then stays larger than the size the copy step
 * assumes, so each tile copies the wrong corner of its render (black margin) and no
 * render, resize or rebind fixes it. Sync the canvas to the max size on every render.
 */
function syncOffscreenCanvasSize(proto: EnginePrototype): void {
  proto._resizeOffScreenCanvasForViewport = function (
    this: { contextPool?: ContextPoolLike },
    viewport: { id: string; canvas: HTMLCanvasElement },
    container: { width?: number; height?: number },
    offscreenMultiRenderWindow: { resize: () => void }
  ) {
    const pool = this.contextPool;
    const contextIndex = pool?.getContextIndexForViewport(viewport.id);
    if (!pool || contextIndex === undefined) {
      return;
    }
    pool.updateViewportSize(viewport.id, viewport.canvas.width, viewport.canvas.height);
    const maxSize = pool.getMaxSizeForContext(contextIndex);
    if (!maxSize?.width || !maxSize.height) {
      return;
    }
    if (container.width === maxSize.width && container.height === maxSize.height) {
      return;
    }
    container.width = maxSize.width;
    container.height = maxSize.height;
    offscreenMultiRenderWindow.resize();
  };
}

type VtkRendererLike = { delete?: () => void };
type MultiRenderWindowLike = {
  getRenderer: (id: string) => VtkRendererLike | undefined;
  getRenderers: () => Array<{ id: string; renderer: VtkRendererLike }>;
  removeRenderer: (id: string) => void;
  getRenderWindow: () => {
    getRenderers: () => VtkRendererLike[];
    removeRenderer: (renderer: VtkRendererLike) => void;
  };
};
type ContextPoolEngineImpl = {
  contextPool?: ContextPoolLike & {
    getAllContexts?: () => MultiRenderWindowLike[];
    removeViewport?: (viewportId: string) => void;
  };
  _viewports?: Map<string, { isDisabled?: boolean }>;
  _needsRender?: Set<string>;
  getWidgetRenderers?: () => Map<VtkRendererLike, string>;
};

/**
 * vtkOffscreenMultiRenderWindow.addRenderer overwrites its id map but keeps the old
 * renderer in the render window. The engine only toggles renderers through the map,
 * so the orphan keeps drawing (full size, black background) over the tile it shared
 * a context with. Removes the viewport's renderers, and orphans, from every context.
 */
function removeViewportRenderers(engine: ContextPoolEngineImpl, viewportId: string): void {
  let widgetRenderers = new Map<VtkRendererLike, string>();
  try {
    widgetRenderers = engine.getWidgetRenderers?.() ?? widgetRenderers;
  } catch {
    // Viewports mid-teardown.
  }

  engine.contextPool?.getAllContexts?.()?.forEach(context => {
    try {
      if (context.getRenderer(viewportId)) {
        context.removeRenderer(viewportId);
      }
      const mapped = new Set(context.getRenderers().map(({ renderer }) => renderer));
      const renderWindow = context.getRenderWindow();
      renderWindow.getRenderers().forEach(renderer => {
        if (!mapped.has(renderer) && !widgetRenderers.has(renderer)) {
          renderWindow.removeRenderer(renderer);
          renderer.delete?.();
        }
      });
    } catch (error) {
      console.warn('[renderLoopGuard] Could not clean renderers of a WebGL context:', error);
    }
  });
}

/**
 * Base disableElement resets the viewport first; when that throws (VTK teardown during
 * fast paging) the viewport stays registered, its renderer stays in the context and the
 * pool keeps its size. The next enable of the tile then adds a second renderer (black
 * orphan) or finds a half-removed viewport. Finish the teardown whatever happened.
 */
function guardContextPoolViewportLifecycle(proto: EnginePrototype): void {
  const originalDisable = proto.disableElement as ((viewportId: string) => void) | undefined;
  if (typeof originalDisable === 'function') {
    proto.disableElement = function (this: ContextPoolEngineImpl, viewportId: string) {
      try {
        originalDisable.call(this, viewportId);
      } catch (error) {
        console.warn(
          `[renderLoopGuard] disableElement(${viewportId}) failed; finishing the teardown.`,
          error
        );
        const viewport = this._viewports?.get(viewportId);
        if (viewport) {
          viewport.isDisabled = true;
          this._viewports?.delete(viewportId);
        }
        this._needsRender?.delete(viewportId);
      } finally {
        removeViewportRenderers(this, viewportId);
        this.contextPool?.removeViewport?.(viewportId);
      }
    };
  }

  const originalAdd = proto.addVtkjsDrivenViewport as
    | ((entry: { viewportId: string }) => void)
    | undefined;
  if (typeof originalAdd === 'function') {
    proto.addVtkjsDrivenViewport = function (
      this: ContextPoolEngineImpl,
      entry: { viewportId: string }
    ) {
      removeViewportRenderers(this, entry.viewportId);
      return originalAdd.call(this, entry);
    };
  }
}

type TextureUnitManagerLike = {
  getNumberOfTextureUnits?: () => number;
  isAllocated?: (unit: number) => boolean;
  freeAll?: () => void;
};
type OpenGLRenderWindowLike = {
  getTextureUnitManager?: () => TextureUnitManagerLike | undefined;
  getReferenceByName?: (name: string) => unknown;
};
type RenderWindowWithViews = {
  getRenderers?: () => Array<{ setDraw?: (draw: boolean) => void }>;
  getViews?: () => Array<{
    getRenderPasses?: () => unknown;
    setRenderPasses?: (passes: unknown) => void;
  }>;
};
type RenderContextLike = {
  getOpenGLRenderWindow?: () => OpenGLRenderWindowLike | undefined;
  getRenderWindow?: () => RenderWindowWithViews | undefined;
};

/** Texture units of one WebGL context that vtk holds; between renders none should be held. */
export function getTextureUnitUsage(
  openGLRenderWindow: OpenGLRenderWindowLike | undefined
): { inUse: number; total: number } | null {
  const manager = openGLRenderWindow?.getTextureUnitManager?.();
  const total = manager?.getNumberOfTextureUnits?.() ?? 0;
  if (!manager?.isAllocated || !total) {
    return null;
  }
  let inUse = 0;
  for (let unit = 0; unit < total; unit++) {
    if (manager.isAllocated(unit)) {
      inUse += 1;
    }
  }
  return { inUse, total };
}

function releaseStuckTextureUnits(openGLRenderWindow: OpenGLRenderWindowLike | undefined) {
  const usage = getTextureUnitUsage(openGLRenderWindow);
  if (!usage?.inUse) {
    return null;
  }
  openGLRenderWindow?.getTextureUnitManager?.()?.freeAll?.();
  const textureUnitIds = openGLRenderWindow?.getReferenceByName?.('_textureResourceIds');
  if (textureUnitIds instanceof Map) {
    textureUnitIds.clear();
  }
  return usage;
}

const STUCK_UNITS_LOG_INTERVAL_MS = 5000;
const stuckUnitsLoggedAt = new Map<number, number>();

/**
 * vtk takes a texture unit per texture when it draws and frees it after the draw. A
 * render that throws midway (texture upload failing under memory pressure, a mapper
 * torn down by paging) never frees them, and the render guard swallows the error.
 * A WebGL context has only ~16 units, so after a few such failures every image drawn
 * on that context finds no unit, is drawn without its texture and the tile stays black
 * while frames keep loading. Free them after every render on the context.
 */
function guardRenderTextureUnits(proto: EnginePrototype): void {
  const original = proto._renderViewportWithContext as
    | ((viewport: { id: string }, context: RenderContextLike, container: unknown) => unknown)
    | undefined;
  if (typeof original !== 'function') {
    return;
  }
  proto._renderViewportWithContext = function (
    this: { contextPool?: ContextPoolLike },
    viewport: { id: string },
    context: RenderContextLike,
    container: unknown
  ) {
    let view: ReturnType<NonNullable<RenderWindowWithViews['getViews']>>[number] | undefined;
    let renderPasses: unknown;
    try {
      view = context?.getRenderWindow?.()?.getViews?.()?.[0];
      renderPasses = view?.getRenderPasses?.();
    } catch {
      // Context being torn down.
    }

    let failed = false;
    try {
      return original.call(this, viewport, context, container);
    } catch (error) {
      failed = true;
      throw error;
    } finally {
      try {
        if (failed) {
          // The engine leaves this viewport's renderer drawing and its render passes set.
          context?.getRenderWindow?.()?.getRenderers?.()?.forEach(renderer => renderer.setDraw?.(false));
          if (renderPasses) {
            view?.setRenderPasses?.(renderPasses);
          }
        }
        const released = releaseStuckTextureUnits(context?.getOpenGLRenderWindow?.());
        if (released) {
          const contextIndex = this.contextPool?.getContextIndexForViewport(viewport.id) ?? -1;
          const now = Date.now();
          if (now - (stuckUnitsLoggedAt.get(contextIndex) ?? 0) > STUCK_UNITS_LOG_INTERVAL_MS) {
            stuckUnitsLoggedAt.set(contextIndex, now);
            console.warn(
              `[renderLoopGuard] WebGL context ${contextIndex} had ${released.inUse}/${released.total} texture units stuck after ${
                failed ? 'a failed' : 'a'
              } render of ${viewport.id}; released them.`
            );
          }
        }
      } catch {
        // Diagnostics and cleanup must not break the render loop.
      }
    }
  };
}

type CoreRendererLike = object;
type RebuildableContext = {
  getRenderers: () => Array<{ id: string; renderer: CoreRendererLike }>;
  getRenderWindow: () => {
    getRenderers: () => CoreRendererLike[];
    addRenderer: (renderer: CoreRendererLike) => void;
    removeRenderer: (renderer: CoreRendererLike) => void;
  };
  getOpenGLRenderWindow?: () =>
    | (OpenGLRenderWindowLike & {
        getContext?: () => WebGLRenderingContext | null;
        releaseGraphicsResources?: () => void;
      })
    | undefined;
  getReferenceByName?: (name: string) => unknown;
  resize: () => void;
  delete?: () => void;
};
type RebuildablePool = {
  contexts: RebuildableContext[];
  offScreenCanvasContainers: Array<{ width?: number; height?: number }>;
  constructor: new (count: number) => RebuildablePool;
  viewportToContext: Map<string, number>;
  getContextIndexForViewport: (viewportId: string) => number | undefined;
  getMaxSizeForContext: (contextIndex: number) => { width: number; height: number } | undefined;
};

const CONTEXT_REBUILD_COOLDOWN_MS = 20000;
const contextRebuiltAt = new Map<number, number>();

/**
 * Replaces the WebGL context a viewport draws with by a new one, moving every renderer
 * of that context (with its actors, image data and camera) over. vtk re-uploads the
 * textures on the next render. Tiles on the other contexts are not touched, and no
 * viewport is re-created. Returns the viewports moved, or null when nothing was done.
 */
export function rebuildViewportWebGlContext(
  engine: unknown,
  viewportId: string
): { contextIndex: number; viewportIds: string[] } | null {
  const eng = engine as {
    hasBeenDestroyed?: boolean;
    contextPool?: RebuildablePool;
    _setViewportsToBeRenderedNextFrame?: (viewportIds: string[]) => void;
  } | null;
  const pool = eng && !eng.hasBeenDestroyed ? eng.contextPool : undefined;
  const contextIndex = pool?.getContextIndexForViewport(viewportId);
  if (!pool || contextIndex === undefined || !pool.contexts?.[contextIndex]) {
    return null;
  }
  const now = Date.now();
  if (now - (contextRebuiltAt.get(contextIndex) ?? 0) < CONTEXT_REBUILD_COOLDOWN_MS) {
    return null;
  }
  contextRebuiltAt.set(contextIndex, now);

  const PoolClass = pool.constructor;
  const freshPool = new PoolClass(1);
  const fresh = freshPool.contexts[0];
  const freshContainer = freshPool.offScreenCanvasContainers[0];
  const freshMap = fresh?.getReferenceByName?.('rendererMap') as
    | Record<string, CoreRendererLike>
    | undefined;
  if (!fresh || !freshContainer || !freshMap) {
    return null;
  }

  const old = pool.contexts[contextIndex];
  const oldWindow = old.getRenderWindow();
  const freshWindow = fresh.getRenderWindow();
  const mapped = old.getRenderers();
  mapped.forEach(({ id, renderer }) => {
    oldWindow.removeRenderer(renderer);
    freshWindow.addRenderer(renderer);
    freshMap[id] = renderer;
  });
  // Widget renderers live in the window without a map entry.
  oldWindow.getRenderers().slice().forEach(renderer => {
    oldWindow.removeRenderer(renderer);
    freshWindow.addRenderer(renderer);
  });

  const maxSize = pool.getMaxSizeForContext(contextIndex);
  if (maxSize?.width && maxSize.height) {
    freshContainer.width = maxSize.width;
    freshContainer.height = maxSize.height;
  }
  pool.contexts[contextIndex] = fresh;
  pool.offScreenCanvasContainers[contextIndex] = freshContainer;
  fresh.resize();

  const oldOpenGLWindow = old.getOpenGLRenderWindow?.();
  const oldGl = oldOpenGLWindow?.getContext?.() ?? null;
  try {
    oldOpenGLWindow?.releaseGraphicsResources?.();
    old.delete?.();
  } catch {
    // The old context is dropped either way.
  }
  try {
    // Frees its GPU memory now instead of at garbage collection.
    oldGl?.getExtension('WEBGL_lose_context')?.loseContext();
  } catch {
    // Already lost.
  }

  const viewportIds = mapped.map(({ id }) => id);
  try {
    eng?._setViewportsToBeRenderedNextFrame?.(viewportIds);
  } catch {
    // Engine torn down meanwhile.
  }
  return { contextIndex, viewportIds };
}

export type RenderProbe = {
  /** WebGL drew non-black pixels into the offscreen region of the viewport. */
  glDrewContent: boolean | null;
  /** The tile's 2D canvas context was lost (GPU memory pressure); copies draw nothing. */
  onscreenContextLost: boolean | null;
  /** The copy left non-black pixels on the tile canvas. */
  onscreenHasContent: boolean | null;
  at: number;
};

const PROBE_GRID = 5;
const PROBE_BLACK_MAX = 6;
const requestedProbes = new Set<string>();
const renderProbes = new Map<string, RenderProbe>();

/** Probe the next render of this viewport (one readback, then off). */
export function requestRenderProbe(viewportId: string): void {
  requestedProbes.add(viewportId);
}

export function getRenderProbe(viewportId: string): RenderProbe | undefined {
  return renderProbes.get(viewportId);
}

function glRegionHasContent(
  offScreenCanvas: HTMLCanvasElement,
  width: number,
  height: number
): boolean | null {
  const gl = (offScreenCanvas.getContext('webgl2') ?? offScreenCanvas.getContext('webgl')) as
    | WebGLRenderingContext
    | null;
  if (!gl || gl.isContextLost()) {
    return null;
  }
  const pixel = new Uint8Array(4);
  for (let row = 1; row <= PROBE_GRID; row++) {
    for (let col = 1; col <= PROBE_GRID; col++) {
      const x = Math.floor((width * col) / (PROBE_GRID + 1));
      const y = Math.floor((height * row) / (PROBE_GRID + 1));
      gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
      if (pixel[0] > PROBE_BLACK_MAX || pixel[1] > PROBE_BLACK_MAX || pixel[2] > PROBE_BLACK_MAX) {
        return true;
      }
    }
  }
  return false;
}

function canvas2dHasContent(ctx: CanvasRenderingContext2D, width: number, height: number): boolean {
  for (let row = 1; row <= PROBE_GRID; row++) {
    for (let col = 1; col <= PROBE_GRID; col++) {
      const x = Math.floor((width * col) / (PROBE_GRID + 1));
      const y = Math.floor((height * row) / (PROBE_GRID + 1));
      const [r, g, b] = ctx.getImageData(x, y, 1, 1).data;
      if (r > PROBE_BLACK_MAX || g > PROBE_BLACK_MAX || b > PROBE_BLACK_MAX) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Probes run inside the render task, right after WebGL drew the viewport: later the
 * drawing buffer is already cleared and cannot be read back.
 */
function probeCopyToOnscreenCanvas(proto: EnginePrototype): void {
  const original = proto._copyToOnscreenCanvas as
    | ((viewport: { id: string; canvas: HTMLCanvasElement }, offScreenCanvas: HTMLCanvasElement) => unknown)
    | undefined;
  if (typeof original !== 'function') {
    return;
  }
  proto._copyToOnscreenCanvas = function (
    this: unknown,
    viewport: { id: string; canvas: HTMLCanvasElement },
    offScreenCanvas: HTMLCanvasElement
  ) {
    if (!requestedProbes.has(viewport.id)) {
      return original.call(this, viewport, offScreenCanvas);
    }
    requestedProbes.delete(viewport.id);
    const { width, height } = viewport.canvas;
    let glDrewContent: boolean | null = null;
    try {
      glDrewContent = glRegionHasContent(offScreenCanvas, width, height);
    } catch {
      glDrewContent = null;
    }
    const result = original.call(this, viewport, offScreenCanvas);
    let onscreenContextLost: boolean | null = null;
    let onscreenHasContent: boolean | null = null;
    try {
      const ctx = viewport.canvas.getContext('2d') as CanvasRenderingContext2D & {
        isContextLost?: () => boolean;
      };
      onscreenContextLost = ctx?.isContextLost?.() ?? null;
      onscreenHasContent = ctx ? canvas2dHasContent(ctx, width, height) : null;
    } catch {
      // Unreadable canvas.
    }
    renderProbes.set(viewport.id, {
      glDrewContent,
      onscreenContextLost,
      onscreenHasContent,
      at: Date.now(),
    });
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

  const contextPoolProto = (ContextPoolRenderingEngine as unknown as { prototype?: EnginePrototype })
    ?.prototype;
  if (contextPoolProto && typeof contextPoolProto._resizeOffScreenCanvasForViewport === 'function') {
    syncOffscreenCanvasSize(contextPoolProto);
  }
  if (contextPoolProto) {
    guardContextPoolViewportLifecycle(contextPoolProto);
    guardRenderTextureUnits(contextPoolProto);
    probeCopyToOnscreenCanvas(contextPoolProto);
  }

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
