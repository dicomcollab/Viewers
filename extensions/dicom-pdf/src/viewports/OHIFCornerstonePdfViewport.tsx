import React, { useEffect, useState, useRef } from 'react';
import PropTypes from 'prop-types';
import { useSystem, useViewportRef } from '@ohif/core';
import './OHIFCornerstonePdfViewport.css';

const SINGLE_CLICK_DELAY_MS = 400;

/**
 * Image viewports expand to 1×1 from Cornerstone's double-click. The browser
 * PDF plugin never delivers that event to the page, so a shield over the
 * document catches it. A single click or wheel drops the shield so the PDF
 * can scroll. Once the pointer leaves the viewport, the shield comes back.
 */
function OHIFCornerstonePdfViewport({ displaySets, viewportId = 'pdf-viewport' }) {
  const { commandsManager, servicesManager } = useSystem();
  const [url, setUrl] = useState(null);
  const viewportElementRef = useRef(null);
  const viewportRef = useViewportRef(viewportId);
  const singleClickTimer = useRef(null);
  const [style, setStyle] = useState('pdf-yes-click');
  const [pdfInteractive, setPdfInteractive] = useState(false);

  const lastToggleAt = useRef(0);

  useEffect(() => {
    const onDrag = () => setStyle('pdf-no-click');
    document.body.addEventListener('drag', onDrag);
    return function cleanup() {
      document.body.removeEventListener('drag', onDrag);
      viewportRef.unregister();
      if (singleClickTimer.current) {
        clearTimeout(singleClickTimer.current);
      }
    };
    // viewportRef identity changes every render; register/unregister once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const renderedUrl = displaySets?.length === 1 ? displaySets[0].renderedUrl : null;

  useEffect(() => {
    if (!renderedUrl) {
      return;
    }
    let cancelled = false;
    const load = async () => {
      const nextUrl = await renderedUrl;
      if (!cancelled) {
        setUrl(nextUrl);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [renderedUrl]);

  const expandViewport = event => {
    event.preventDefault();
    event.stopPropagation();

    if (singleClickTimer.current) {
      clearTimeout(singleClickTimer.current);
      singleClickTimer.current = null;
    }

    const now = Date.now();
    if (now - lastToggleAt.current < 500) {
      return;
    }
    lastToggleAt.current = now;

    const { viewportGridService } = servicesManager.services;
    if (viewportId && viewportGridService?.setActiveViewportId) {
      viewportGridService.setActiveViewportId(viewportId);
    }
    commandsManager?.run('toggleOneUp');
  };

  const onShieldClick = event => {
    if (event.detail > 1) {
      expandViewport(event);
      return;
    }
    if (singleClickTimer.current) {
      clearTimeout(singleClickTimer.current);
    }
    singleClickTimer.current = setTimeout(() => {
      singleClickTimer.current = null;
      setStyle('pdf-yes-click');
      setPdfInteractive(true);
    }, SINGLE_CLICK_DELAY_MS);
  };

  // The PDF plugin does not bubble mouseleave. Watch page mousemove and
  // put the shield back once the pointer is outside this viewport.
  useEffect(() => {
    if (!pdfInteractive) {
      return;
    }

    const onMouseMove = event => {
      const el = viewportElementRef.current;
      if (!el) {
        return;
      }
      const rect = el.getBoundingClientRect();
      const inside =
        event.clientX >= rect.left &&
        event.clientX <= rect.right &&
        event.clientY >= rect.top &&
        event.clientY <= rect.bottom;
      if (!inside) {
        if (singleClickTimer.current) {
          clearTimeout(singleClickTimer.current);
          singleClickTimer.current = null;
        }
        setPdfInteractive(false);
      }
    };

    document.addEventListener('mousemove', onMouseMove);
    return () => document.removeEventListener('mousemove', onMouseMove);
  }, [pdfInteractive]);

  if (displaySets && displaySets.length > 1) {
    throw new Error(
      'OHIFCornerstonePdfViewport: only one display set is supported for dicom pdf right now'
    );
  }

  return (
    <div
      className="bg-primary-black relative h-full w-full text-white"
      onDoubleClick={expandViewport}
      ref={el => {
        viewportElementRef.current = el;
        if (el) {
          viewportRef.register(el);
        }
      }}
      data-viewport-id={viewportId}
    >
      <object
        data={url}
        type="application/pdf"
        className={style}
      >
        <div>No online PDF viewer installed</div>
      </object>
      {!pdfInteractive && (
        <div
          className="pdf-dblclick-shield"
          onClick={onShieldClick}
          onDoubleClick={expandViewport}
          onWheel={() => {
            setStyle('pdf-yes-click');
            setPdfInteractive(true);
          }}
        />
      )}
    </div>
  );
}

OHIFCornerstonePdfViewport.propTypes = {
  displaySets: PropTypes.arrayOf(PropTypes.object).isRequired,
  viewportId: PropTypes.string,
};

export default OHIFCornerstonePdfViewport;
