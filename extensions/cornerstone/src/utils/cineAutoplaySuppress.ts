/**
 * While next/previous paging swaps display sets, CinePlayer and layout autoplay
 * must not start a new clip. In-flight cine setImageIdIndex on a reused viewport
 * aborts the first-frame retrieve (XHR status 0) and leaves a black canvas.
 */
let suppressCineAutoplayUntil = 0;

function shouldSuppressCineAutoplay(): boolean {
  return Date.now() < suppressCineAutoplayUntil;
}

function suppressCineAutoplay(ms = 2200): void {
  suppressCineAutoplayUntil = Date.now() + ms;
}

function getCineAutoplaySuppressRemainingMs(): number {
  return Math.max(0, suppressCineAutoplayUntil - Date.now());
}

export {
  getCineAutoplaySuppressRemainingMs,
  shouldSuppressCineAutoplay,
  suppressCineAutoplay,
};
