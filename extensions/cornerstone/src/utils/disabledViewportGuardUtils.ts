type ContextPoolLike = {
  getContextIndexForViewport?: (viewportId: string) => number | undefined;
  getContextByIndex?: (index: number | undefined) => {
    context?: { getRenderer?: (viewportId: string) => unknown };
  } | null;
};

export type FallbackViewportCamera = {
  viewUp: number[];
  viewPlaneNormal: number[];
  position: number[];
  focalPoint: number[];
  parallelProjection: boolean;
  parallelScale: number;
  viewAngle: number;
  flipHorizontal: boolean;
  flipVertical: boolean;
  rotation: number;
};

/**
 * ContextPoolRenderingEngine.getRenderer destructures contextData with no
 * null check. During ELEMENT_DISABLED / 2x2 paging the pool entry is already
 * gone, which throws:
 *   Cannot destructure property 'context' of 'contextData' as it is null
 */
export function resolveContextPoolRenderer(
  contextPool: ContextPoolLike | null | undefined,
  viewportId: string
): unknown {
  if (!contextPool?.getContextByIndex) {
    return null;
  }

  const contextIndex = contextPool.getContextIndexForViewport?.(viewportId);
  const contextData = contextPool.getContextByIndex(contextIndex);
  if (!contextData?.context) {
    return null;
  }

  return contextData.context.getRenderer?.(viewportId) ?? null;
}

export function getFallbackViewportCamera(viewport?: {
  flipHorizontal?: boolean;
  flipVertical?: boolean;
}): FallbackViewportCamera {
  return {
    viewUp: [0, 1, 0],
    viewPlaneNormal: [0, 0, -1],
    position: [0, 0, 1],
    focalPoint: [0, 0, 0],
    parallelProjection: true,
    parallelScale: 1,
    viewAngle: 90,
    flipHorizontal: Boolean(viewport?.flipHorizontal),
    flipVertical: Boolean(viewport?.flipVertical),
    rotation: 0,
  };
}

export function shouldSkipDisabledViewportCamera(viewport?: {
  isDisabled?: boolean;
} | null): boolean {
  return Boolean(viewport?.isDisabled);
}

export function isMissingRendererContextError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return (
    message.includes("Cannot destructure property 'context'") ||
    message.includes('No renderer found for the viewport')
  );
}
