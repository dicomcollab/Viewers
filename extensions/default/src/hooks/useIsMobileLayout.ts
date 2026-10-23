import { useEffect, useState } from 'react';

/** Tablet landscape and below; desktop layouts stay wider. */
export const MOBILE_TABLET_MAX_WIDTH_PX = 1024;

/** iPadOS 13+ may report as Mac; still treat as tablet when touch-capable. */
export const isIPad = (): boolean =>
  typeof navigator !== 'undefined' &&
  (/iPad/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));

/**
 * Phones and tablets only — not desktop browsers with a narrow window.
 * Uses touch-primary media queries plus viewport width (and iPad fallback).
 */
export const isMobileOrTabletScreen = (): boolean => {
  if (typeof window === 'undefined') {
    return false;
  }

  const withinMobileTabletWidth = window.matchMedia(
    `(max-width: ${MOBILE_TABLET_MAX_WIDTH_PX}px)`
  ).matches;

  if (!withinMobileTabletWidth) {
    return false;
  }

  if (isIPad()) {
    return true;
  }

  return window.matchMedia('(hover: none), (pointer: coarse)').matches;
};

/**
 * Reactive mobile/tablet layout flag — updates on resize / orientation / media changes.
 */
export default function useIsMobileLayout(): boolean {
  const [isMobileLayout, setIsMobileLayout] = useState(() => isMobileOrTabletScreen());

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const widthQuery = window.matchMedia(`(max-width: ${MOBILE_TABLET_MAX_WIDTH_PX}px)`);
    const touchQuery = window.matchMedia('(hover: none), (pointer: coarse)');

    const update = () => setIsMobileLayout(isMobileOrTabletScreen());

    const addListener = (mq: MediaQueryList, handler: () => void) => {
      if (typeof mq.addEventListener === 'function') {
        mq.addEventListener('change', handler);
        return () => mq.removeEventListener('change', handler);
      }
      // Safari < 14
      mq.addListener(handler);
      return () => mq.removeListener(handler);
    };

    const removeWidth = addListener(widthQuery, update);
    const removeTouch = addListener(touchQuery, update);
    window.addEventListener('orientationchange', update);
    window.addEventListener('resize', update);

    update();

    return () => {
      removeWidth();
      removeTouch();
      window.removeEventListener('orientationchange', update);
      window.removeEventListener('resize', update);
    };
  }, []);

  return isMobileLayout;
}
