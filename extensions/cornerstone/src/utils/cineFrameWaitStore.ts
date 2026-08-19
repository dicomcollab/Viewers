type CineFrameWaitState = {
  viewportId: string;
  imageIndex: number;
  imageId: string;
};

const waitByViewport = new Map<string, CineFrameWaitState>();
const listeners = new Set<(viewportId: string, waiting: CineFrameWaitState | null) => void>();

function setCineWaitingForFrame(
  viewportId: string | undefined,
  waiting: Omit<CineFrameWaitState, 'viewportId'> | null
): void {
  if (!viewportId) {
    return;
  }

  const current = waitByViewport.get(viewportId) ?? null;
  const next = waiting ? { ...waiting, viewportId } : null;
  const unchanged =
    (current == null && next == null) ||
    (current != null &&
      next != null &&
      current.imageId === next.imageId &&
      current.imageIndex === next.imageIndex);

  if (unchanged) {
    return;
  }

  if (next) {
    waitByViewport.set(viewportId, next);
  } else {
    waitByViewport.delete(viewportId);
  }

  listeners.forEach(listener => listener(viewportId, next));
}

function getCineWaitingForFrame(viewportId: string): CineFrameWaitState | null {
  return waitByViewport.get(viewportId) ?? null;
}

function subscribeCineWaitingForFrame(
  listener: (viewportId: string, waiting: CineFrameWaitState | null) => void
): () => void {
  listeners.add(listener);

  return () => listeners.delete(listener);
}

export { getCineWaitingForFrame, setCineWaitingForFrame, subscribeCineWaitingForFrame };
export type { CineFrameWaitState };
