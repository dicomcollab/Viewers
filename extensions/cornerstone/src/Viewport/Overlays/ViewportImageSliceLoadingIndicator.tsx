import React, { useEffect, useState, useRef } from 'react';
import PropTypes from 'prop-types';
import { Enums } from '@cornerstonejs/core';
import { isMissingInstanceLoadError } from '@ohif/core';
import {
  getCineWaitingForFrame,
  subscribeCineWaitingForFrame,
} from '../../utils/cineFrameWaitStore';
import {
  endFirstImageWait,
  isAwaitingFirstImage,
  subscribeFirstImageWait,
} from '../../utils/viewportFirstImageStore';

/** Cached images bind within a frame or two; skip the overlay so it does not flash. */
const FIRST_IMAGE_OVERLAY_DELAY_MS = 150;

function Spinner({ className = 'h-8 w-8' }: { className?: string }) {
  return (
    <div
      className={`${className} border-primary-light animate-spin rounded-full border-2 border-t-transparent`}
      role="status"
      aria-label="Loading"
    />
  );
}

function ViewportImageSliceLoadingIndicator({ viewportData, element, viewportId }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(false);
  const [cineWaiting, setCineWaiting] = useState(() =>
    viewportId ? Boolean(getCineWaitingForFrame(viewportId)) : false
  );
  const [awaitingFirstImage, setAwaitingFirstImage] = useState(() =>
    isAwaitingFirstImage(viewportId)
  );
  const [showFirstImageOverlay, setShowFirstImageOverlay] = useState(false);

  const loadIndicatorRef = useRef(null);
  const imageIdToBeLoaded = useRef(null);
  const awaitingFirstImageRef = useRef(awaitingFirstImage);
  awaitingFirstImageRef.current = awaitingFirstImage;

  const setLoadingState = evt => {
    clearTimeout(loadIndicatorRef.current);

    loadIndicatorRef.current = setTimeout(() => {
      setLoading(true);
    }, 50);
  };

  const setFinishLoadingState = evt => {
    clearTimeout(loadIndicatorRef.current);

    setLoading(false);
    setError(false);
    endFirstImageWait(viewportId);
  };

  const setErrorState = evt => {
    clearTimeout(loadIndicatorRef.current);

    const isFirstImage = awaitingFirstImageRef.current;
    if (isFirstImage || imageIdToBeLoaded.current === evt.detail.imageId) {
      if (isMissingInstanceLoadError(evt.detail.error)) {
        setLoading(false);
        setError(false);
      } else {
        setError(evt.detail.error || true);
      }
      imageIdToBeLoaded.current = null;
    }
  };

  useEffect(() => {
    element.addEventListener(Enums.Events.STACK_VIEWPORT_SCROLL, setLoadingState);
    element.addEventListener(Enums.Events.IMAGE_LOAD_ERROR, setErrorState);
    element.addEventListener(Enums.Events.STACK_NEW_IMAGE, setFinishLoadingState);

    return () => {
      element.removeEventListener(Enums.Events.STACK_VIEWPORT_SCROLL, setLoadingState);

      element.removeEventListener(Enums.Events.STACK_NEW_IMAGE, setFinishLoadingState);

      element.removeEventListener(Enums.Events.IMAGE_LOAD_ERROR, setErrorState);
    };
  }, [element, viewportData, viewportId]);

  useEffect(() => {
    if (!viewportId) {
      return;
    }

    setAwaitingFirstImage(isAwaitingFirstImage(viewportId));

    return subscribeFirstImageWait((id, waiting) => {
      if (id !== viewportId) {
        return;
      }
      setAwaitingFirstImage(waiting);
      if (waiting) {
        // A new display set is binding; drop the previous series' error/loading state.
        setError(false);
        setLoading(false);
      }
    });
  }, [viewportId]);

  useEffect(() => {
    if (!awaitingFirstImage) {
      setShowFirstImageOverlay(false);
      return;
    }

    const timerId = setTimeout(() => setShowFirstImageOverlay(true), FIRST_IMAGE_OVERLAY_DELAY_MS);
    return () => clearTimeout(timerId);
  }, [awaitingFirstImage]);

  useEffect(() => {
    if (!viewportId) {
      return;
    }

    setCineWaiting(Boolean(getCineWaitingForFrame(viewportId)));

    return subscribeCineWaitingForFrame((id, waiting) => {
      if (id === viewportId) {
        setCineWaiting(Boolean(waiting));
      }
    });
  }, [viewportId]);

  useEffect(() => () => clearTimeout(loadIndicatorRef.current), []);

  if (error) {
    const message = typeof error === 'string' ? error : (error as Error)?.message;

    return (
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/60">
        <div className="max-w-[80%] rounded-md bg-black/70 px-4 py-3 text-center">
          <h4 className="text-primary-light text-base">Unable to load image</h4>
          <p className="mt-1 text-xs text-white/80">
            {message || 'An error occurred while loading this image.'}
          </p>
        </div>
      </div>
    );
  }

  if (awaitingFirstImage) {
    if (!showFirstImageOverlay) {
      return null;
    }

    return (
      // pointer-events-none so wheel/scroll still reach the viewport underneath.
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/60">
        <div className="flex flex-col items-center gap-3 px-4 py-3 text-center">
          <Spinner />
          <p className="text-primary-light text-sm">Loading image…</p>
        </div>
      </div>
    );
  }

  if (loading || cineWaiting) {
    return (
      // IMPORTANT: we need to use the pointer-events-none class to prevent the loading indicator from
      // interacting with the mouse, since scrolling should propagate to the viewport underneath
      <div className="pointer-events-none absolute top-0 left-0 h-full w-full bg-black/40">
        <div className="flex h-full w-full flex-col items-center justify-center gap-2">
          <Spinner className="h-6 w-6" />
          <p className="text-primary-light text-sm">
            {cineWaiting ? 'Loading next frame…' : 'Loading…'}
          </p>
        </div>
      </div>
    );
  }

  return null;
}

ViewportImageSliceLoadingIndicator.propTypes = {
  error: PropTypes.object,
  element: PropTypes.object,
  viewportData: PropTypes.object,
  viewportId: PropTypes.string,
};

export default ViewportImageSliceLoadingIndicator;
