import React, { useEffect, useState, useRef } from 'react';
import PropTypes from 'prop-types';
import { Enums } from '@cornerstonejs/core';
import { isMissingInstanceLoadError } from '@ohif/core';
import { getCineWaitingForFrame, subscribeCineWaitingForFrame } from '../../utils/cineFrameWaitStore';

function ViewportImageSliceLoadingIndicator({ viewportData, element, viewportId }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [cineWaiting, setCineWaiting] = useState(() =>
    viewportId ? Boolean(getCineWaitingForFrame(viewportId)) : false
  );

  const loadIndicatorRef = useRef(null);
  const imageIdToBeLoaded = useRef(null);

  const setLoadingState = evt => {
    clearTimeout(loadIndicatorRef.current);

    loadIndicatorRef.current = setTimeout(() => {
      setLoading(true);
    }, 50);
  };

  const setFinishLoadingState = evt => {
    clearTimeout(loadIndicatorRef.current);

    setLoading(false);
  };

  const setErrorState = evt => {
    clearTimeout(loadIndicatorRef.current);

    if (imageIdToBeLoaded.current === evt.detail.imageId) {
      if (isMissingInstanceLoadError(evt.detail.error)) {
        setLoading(false);
        setError(false);
      } else {
        setError(evt.detail.error);
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
  }, [element, viewportData]);

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

  if (error) {
    return (
      <>
        <div className="absolute top-0 left-0 h-full w-full bg-black opacity-50">
          <div className="transparent flex h-full w-full items-center justify-center">
            <p className="text-primary-light text-xl font-light">
              <h4>Error Loading Image</h4>
              <p>An error has occurred.</p>
              <p>{error}</p>
            </p>
          </div>
        </div>
      </>
    );
  }

  if (loading || cineWaiting) {
    return (
      // IMPORTANT: we need to use the pointer-events-none class to prevent the loading indicator from
      // interacting with the mouse, since scrolling should propagate to the viewport underneath
      <div className="pointer-events-none absolute top-0 left-0 h-full w-full bg-black/40">
        <div className="transparent flex h-full w-full items-center justify-center">
          <p className="text-primary-light text-xl font-light">
            {cineWaiting ? 'Loading next frame…' : 'Loading...'}
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
};

export default ViewportImageSliceLoadingIndicator;
