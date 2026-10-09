/**
 * Tracks viewports whose new display set is bound but has not painted its
 * first image yet (canvas is blank while the first frame downloads/decodes).
 * Each begin returns a token so a slower, superseded bind cannot clear the
 * wait started by a newer one on the same viewport.
 */
const pendingByViewport = new Map<string, number>();
const listeners = new Set<(viewportId: string, waiting: boolean) => void>();
let nextToken = 1;

function notify(viewportId: string, waiting: boolean): void {
  listeners.forEach(listener => listener(viewportId, waiting));
}

function beginFirstImageWait(viewportId: string | undefined): number {
  if (!viewportId) {
    return 0;
  }

  const token = nextToken++;
  const wasWaiting = pendingByViewport.has(viewportId);
  pendingByViewport.set(viewportId, token);

  if (!wasWaiting) {
    notify(viewportId, true);
  }

  return token;
}

/** Omit `token` to clear unconditionally (e.g. the image actually rendered). */
function endFirstImageWait(viewportId: string | undefined, token?: number): void {
  if (!viewportId || !pendingByViewport.has(viewportId)) {
    return;
  }

  if (token != null && pendingByViewport.get(viewportId) !== token) {
    return;
  }

  pendingByViewport.delete(viewportId);
  notify(viewportId, false);
}

function isAwaitingFirstImage(viewportId: string | undefined): boolean {
  return Boolean(viewportId && pendingByViewport.has(viewportId));
}

function subscribeFirstImageWait(
  listener: (viewportId: string, waiting: boolean) => void
): () => void {
  listeners.add(listener);

  return () => listeners.delete(listener);
}

export { beginFirstImageWait, endFirstImageWait, isAwaitingFirstImage, subscribeFirstImageWait };
