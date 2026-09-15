import { ContextPoolRenderingEngine, StackViewport, Viewport } from '@cornerstonejs/core';
import { ReferenceLinesTool } from '@cornerstonejs/tools';
import {
  getFallbackViewportCamera,
  isMissingRendererContextError,
  resolveContextPoolRenderer,
  shouldSkipDisabledViewportCamera,
} from './disabledViewportGuardUtils';

/**
 * Layout and hanging-protocol changes destroy StackViewport instances and
 * recreate them under the same id. Cornerstone cine/scroll can still have a
 * 40ms debounce timeout that calls setImageIdIndex on the old instance,
 * which throws:
 *
 *   "The stack viewport has been destroyed and is no longer usable."
 *
 * Next/Previous paging also fires CORNERSTONE_ELEMENT_DISABLED while
 * ReferenceLines still calls getCamera(). ContextPoolRenderingEngine.getRenderer
 * then destructures a null pool entry. Guard those prototypes so disable is a
 * no-op instead of an uncaught TypeError.
 */
function patchStackViewportDestroyedGuard(): void {
  patchStackViewportCineGuards();
  patchContextPoolGetRenderer();
  patchViewportCameraGuards();
  patchReferenceLinesDisabledGuard();
}

function patchStackViewportCineGuards(): void {
  const proto = StackViewport.prototype as StackViewport & {
    __ohifDestroyedGuard?: boolean;
    isDisabled?: boolean;
    setImageIdIndex: (...args: unknown[]) => unknown;
    scroll?: (...args: unknown[]) => unknown;
  };

  if (proto.__ohifDestroyedGuard) {
    return;
  }

  proto.__ohifDestroyedGuard = true;

  const originalSetImageIdIndex = proto.setImageIdIndex;
  proto.setImageIdIndex = function patchedSetImageIdIndex(...args) {
    if (this.isDisabled) {
      return Promise.resolve(undefined);
    }

    try {
      return originalSetImageIdIndex.apply(this, args);
    } catch (error) {
      if (this.isDisabled) {
        return Promise.resolve(undefined);
      }

      throw error;
    }
  };

  const originalScroll = proto.scroll;
  if (typeof originalScroll === 'function') {
    proto.scroll = function patchedScroll(...args) {
      if (this.isDisabled) {
        return;
      }

      try {
        return originalScroll.apply(this, args);
      } catch (error) {
        if (this.isDisabled) {
          return;
        }

        throw error;
      }
    };
  }
}

function patchContextPoolGetRenderer(): void {
  const proto = ContextPoolRenderingEngine.prototype as ContextPoolRenderingEngine & {
    __ohifDisabledContextGuard?: boolean;
    contextPool?: Parameters<typeof resolveContextPoolRenderer>[0];
    useCPURendering?: boolean;
  };

  if (proto.__ohifDisabledContextGuard) {
    return;
  }

  proto.__ohifDisabledContextGuard = true;

  proto.getRenderer = function patchedGetRenderer(viewportId: string) {
    return resolveContextPoolRenderer(this.contextPool, viewportId);
  };

  const originalGetOffscreen = proto.getOffscreenMultiRenderWindow;
  if (typeof originalGetOffscreen === 'function') {
    proto.getOffscreenMultiRenderWindow = function patchedGetOffscreen(viewportId: string) {
      if (this.useCPURendering) {
        return originalGetOffscreen.call(this, viewportId);
      }

      const contextIndex = this.contextPool?.getContextIndexForViewport?.(viewportId);
      const contextData = this.contextPool?.getContextByIndex?.(contextIndex);
      if (!contextData?.context) {
        return null;
      }

      return contextData.context;
    };
  }
}

function patchViewportCameraGuards(): void {
  const proto = Viewport.prototype as Viewport & {
    __ohifDisabledCameraGuard?: boolean;
    isDisabled?: boolean;
    getRenderer?: () => { getActiveCamera?: () => unknown } | null;
    getCameraNoRotation: () => ReturnType<typeof getFallbackViewportCamera>;
    getCamera: () => ReturnType<typeof getFallbackViewportCamera>;
    getVtkActiveCamera?: () => unknown;
  };

  if (proto.__ohifDisabledCameraGuard) {
    return;
  }

  proto.__ohifDisabledCameraGuard = true;

  const originalGetVtkActiveCamera = proto.getVtkActiveCamera;
  if (typeof originalGetVtkActiveCamera === 'function') {
    proto.getVtkActiveCamera = function patchedGetVtkActiveCamera() {
      if (shouldSkipDisabledViewportCamera(this)) {
        return null;
      }

      try {
        const renderer = this.getRenderer?.();
        if (!renderer) {
          return null;
        }

        return renderer.getActiveCamera?.() ?? originalGetVtkActiveCamera.apply(this);
      } catch (error) {
        if (shouldSkipDisabledViewportCamera(this) || isMissingRendererContextError(error)) {
          return null;
        }

        throw error;
      }
    };
  }

  const originalGetCameraNoRotation = proto.getCameraNoRotation;
  proto.getCameraNoRotation = function patchedGetCameraNoRotation() {
    if (shouldSkipDisabledViewportCamera(this)) {
      return getFallbackViewportCamera(this);
    }

    try {
      const vtkCamera = this.getVtkActiveCamera?.();
      if (!vtkCamera) {
        return getFallbackViewportCamera(this);
      }

      return originalGetCameraNoRotation.apply(this);
    } catch (error) {
      if (shouldSkipDisabledViewportCamera(this) || isMissingRendererContextError(error)) {
        return getFallbackViewportCamera(this);
      }

      throw error;
    }
  };

  const originalGetCamera = proto.getCamera;
  proto.getCamera = function patchedGetCamera() {
    if (shouldSkipDisabledViewportCamera(this)) {
      return getFallbackViewportCamera(this);
    }

    try {
      return originalGetCamera.apply(this);
    } catch (error) {
      if (shouldSkipDisabledViewportCamera(this) || isMissingRendererContextError(error)) {
        return getFallbackViewportCamera(this);
      }

      throw error;
    }
  };
}

function patchReferenceLinesDisabledGuard(): void {
  const proto = ReferenceLinesTool.prototype as typeof ReferenceLinesTool.prototype & {
    __ohifDisabledRenderGuard?: boolean;
    renderAnnotation: (...args: unknown[]) => boolean;
  };

  if (proto.__ohifDisabledRenderGuard) {
    return;
  }

  proto.__ohifDisabledRenderGuard = true;

  const originalRenderAnnotation = proto.renderAnnotation;
  proto.renderAnnotation = function patchedRenderAnnotation(enabledElement, svgDrawingHelper) {
    const viewport = enabledElement?.viewport;
    if (!viewport || shouldSkipDisabledViewportCamera(viewport)) {
      return false;
    }

    try {
      return originalRenderAnnotation.call(this, enabledElement, svgDrawingHelper);
    } catch (error) {
      if (shouldSkipDisabledViewportCamera(viewport) || isMissingRendererContextError(error)) {
        return false;
      }

      throw error;
    }
  };
}

export default patchStackViewportDestroyedGuard;
