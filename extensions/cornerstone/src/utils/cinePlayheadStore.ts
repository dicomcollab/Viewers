/**
 * Cine timeline position per viewport while a US clip plays.
 *
 * The playhead walks every frame 1..N at the clip's FPS whether or not the
 * frame is downloaded yet. A downloaded frame is shown in the viewport; for a
 * frame still downloading the tile shows an empty (black) frame instead, and
 * the next pass of the loop shows it once it has arrived.
 */
export type CinePlayhead = {
  index: number;
  total: number;
  /** False while this frame is still downloading — the tile shows an empty frame. */
  ready: boolean;
};

type Listener = (viewportId: string, playhead: CinePlayhead | null) => void;

const playheads = new Map<string, CinePlayhead>();
const listeners = new Set<Listener>();

function setCinePlayhead(viewportId: string | undefined, playhead: CinePlayhead | null): void {
  if (!viewportId) {
    return;
  }

  const previous = playheads.get(viewportId);

  if (!playhead) {
    if (!previous) {
      return;
    }
    playheads.delete(viewportId);
  } else {
    if (
      previous &&
      previous.index === playhead.index &&
      previous.total === playhead.total &&
      previous.ready === playhead.ready
    ) {
      return;
    }
    playheads.set(viewportId, playhead);
  }

  listeners.forEach(listener => listener(viewportId, playhead));
}

function getCinePlayhead(viewportId: string | undefined): CinePlayhead | null {
  return (viewportId && playheads.get(viewportId)) || null;
}

function subscribeCinePlayhead(listener: Listener): () => void {
  listeners.add(listener);

  return () => listeners.delete(listener);
}

export { getCinePlayhead, setCinePlayhead, subscribeCinePlayhead };
