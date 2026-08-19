import { StackViewport } from '@cornerstonejs/core';

/**
 * Layout and hanging-protocol changes destroy StackViewport instances and
 * recreate them under the same id. Cornerstone cine/scroll can still have a
 * 40ms debounce timeout that calls setImageIdIndex on the old instance,
 * which throws:
 *
 *   "The stack viewport has been destroyed and is no longer usable."
 *
 * Guard the prototype so a destroyed viewport is a no-op instead of an
 * uncaught production error. Callers that need the live instance should
 * re-fetch via renderingEngine.getViewport(viewportId).
 */
function patchStackViewportDestroyedGuard(): void {
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

export default patchStackViewportDestroyedGuard;
