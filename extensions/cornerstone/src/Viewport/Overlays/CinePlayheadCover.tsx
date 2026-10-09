import React, { useEffect, useState } from 'react';
import { getCinePlayhead, subscribeCinePlayhead } from '../../utils/cinePlayheadStore';

/**
 * Empty (black) frame while the cine playhead is on a frame that has not
 * downloaded yet. Rendered first among the overlays so patient info, W/L and
 * the frame counter stay visible on top of it.
 */
function CinePlayheadCover({ viewportId }: { viewportId: string }) {
  const [empty, setEmpty] = useState(() => getCinePlayhead(viewportId)?.ready === false);

  useEffect(() => {
    setEmpty(getCinePlayhead(viewportId)?.ready === false);

    return subscribeCinePlayhead((id, playhead) => {
      if (id === viewportId) {
        setEmpty(playhead?.ready === false);
      }
    });
  }, [viewportId]);

  if (!empty) {
    return null;
  }

  return <div className="pointer-events-none absolute inset-0 bg-black" aria-hidden="true" />;
}

export default CinePlayheadCover;
