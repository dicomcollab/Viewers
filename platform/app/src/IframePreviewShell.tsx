import React, { useEffect, useRef, useState } from 'react';

type IframePreviewShellProps = {
  iframeSrc: string;
};

const POLL_MS = 250;
const READY_TIMEOUT_MS = 120000;

/**
 * Dev/demo shell: simulates a parent app with the OHIF viewer embedded in a half-screen iframe.
 * Only used when `iframePreviewHalfScreen` is true and the page is not already inside an iframe.
 */
function IframePreviewShell({ iframeSrc }: IframePreviewShellProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [isViewerLoading, setIsViewerLoading] = useState(true);
  const [loadTimedOut, setLoadTimedOut] = useState(false);

  useEffect(() => {
    setIsViewerLoading(true);
    setLoadTimedOut(false);

    const iframe = iframeRef.current;
    if (!iframe) {
      return;
    }

    let pollId: ReturnType<typeof setInterval> | null = null;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;
    let ready = false;

    const isViewerReady = () => {
      try {
        const doc = iframe.contentDocument;
        const root = doc?.getElementById('root');
        return Boolean(root && root.childElementCount > 0);
      } catch (e) {
        return false;
      }
    };

    const markReady = () => {
      if (disposed || ready) {
        return;
      }
      ready = true;
      setIsViewerLoading(false);
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
    };

    const startPolling = () => {
      if (isViewerReady()) {
        markReady();
        return;
      }

      pollId = setInterval(() => {
        if (isViewerReady()) {
          if (pollId) {
            clearInterval(pollId);
            pollId = null;
          }
          markReady();
        }
      }, POLL_MS);
    };

    const onLoad = () => {
      startPolling();
    };

    iframe.addEventListener('load', onLoad);
    timeoutId = setTimeout(() => {
      if (!disposed && !ready) {
        setLoadTimedOut(true);
        setIsViewerLoading(false);
      }
    }, READY_TIMEOUT_MS);

    return () => {
      disposed = true;
      iframe.removeEventListener('load', onLoad);
      if (pollId) {
        clearInterval(pollId);
      }
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  }, [iframeSrc]);

  return (
    <div
      style={{
        display: 'flex',
        width: '100vw',
        height: '100vh',
        overflow: 'hidden',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}
    >
      <aside
        style={{
          flex: '0 0 50%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          padding: '2rem',
          background: '#1a1f2e',
          color: '#e8eaed',
          borderRight: '1px solid #2d3548',
          boxSizing: 'border-box',
        }}
      >
        <p
          style={{
            margin: 0,
            fontSize: '0.75rem',
            fontWeight: 600,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: '#7aa2f7',
          }}
        >
          Parent application (preview)
        </p>
        <h1 style={{ margin: '0.75rem 0 0', fontSize: '1.5rem', fontWeight: 600 }}>
          Iframe embed preview
        </h1>
        <p style={{ margin: '1rem 0 0', lineHeight: 1.6, color: '#b0b8c4', maxWidth: '28rem' }}>
          The viewer on the right runs inside an iframe, the same way it would when embedded from
          RIS or another host. The first load in dev can take 10–30 seconds while the bundle
          compiles. Set <code style={{ color: '#c0caf5' }}>iframePreviewHalfScreen</code> to{' '}
          <code style={{ color: '#c0caf5' }}>false</code> in config to load the viewer full-screen
          again.
        </p>
      </aside>
      <div
        style={{
          position: 'relative',
          flex: '0 0 50%',
          width: '50%',
          height: '100%',
          background: '#000',
        }}
      >
        {isViewerLoading && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              zIndex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '1rem',
              background: '#0a0a0a',
              color: '#b0b8c4',
              textAlign: 'center',
              padding: '2rem',
            }}
          >
            <div
              style={{
                width: '2.5rem',
                height: '2.5rem',
                border: '3px solid #2d3548',
                borderTopColor: '#7aa2f7',
                borderRadius: '50%',
                animation: 'ohif-iframe-preview-spin 0.9s linear infinite',
              }}
            />
            <p style={{ margin: 0, fontSize: '0.95rem' }}>Loading viewer in iframe…</p>
            <p style={{ margin: 0, fontSize: '0.8rem', color: '#7a8494', maxWidth: '18rem' }}>
              Dev builds compile on first request; the right panel stays dark until the viewer
              finishes starting.
            </p>
          </div>
        )}
        {loadTimedOut && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              zIndex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'rgba(10, 10, 10, 0.92)',
              color: '#f7768e',
              textAlign: 'center',
              padding: '2rem',
            }}
          >
            <p style={{ margin: 0, maxWidth: '20rem' }}>
              The iframe viewer did not finish loading. Check the browser console and Network tab for
              errors.
            </p>
          </div>
        )}
        <iframe
          ref={iframeRef}
          title="OHIF viewer iframe preview"
          src={iframeSrc}
          style={{
            width: '100%',
            height: '100%',
            border: 'none',
            display: 'block',
          }}
        />
        <style>{`@keyframes ohif-iframe-preview-spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    </div>
  );
}

export default IframePreviewShell;
