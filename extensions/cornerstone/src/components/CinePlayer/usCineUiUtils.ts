/** Height of the per-viewport cine control row (must match CSS). */
export const US_VIEWPORT_CINE_BAR_HEIGHT_PX = 32;

/** Total bottom space reserved from the image (cine bar + gap for action corners). */
export const US_VIEWPORT_BOTTOM_RESERVE_PX =
  US_VIEWPORT_CINE_BAR_HEIGHT_PX + 12;

export type CinePlayMode = 'fps' | 'step';

export function activeTransportClass(isActive: boolean): string {
  return isActive
    ? 'bg-primary text-primary-foreground shadow-sm ring-1 ring-primary/40'
    : 'text-white/80 hover:bg-white/10 hover:text-white';
}

export function modeChipClass(isActive: boolean): string {
  return `inline-flex h-5 max-w-full shrink-0 items-center rounded px-0.5 text-[9px] leading-none font-medium transition-colors ${
    isActive
      ? 'bg-primary text-primary-foreground ring-1 ring-primary/50'
      : 'bg-white/5 text-white/55 hover:bg-white/10 hover:text-white'
  }`;
}

export function setViewportUsCineLayout(
  viewportId: string,
  enabled: boolean,
  onResize?: () => void
): void {
  const element = document.querySelector(
    `[data-viewportid="${viewportId}"]`
  ) as HTMLElement | null;
  const wrapper = element?.closest('.viewport-wrapper') as HTMLElement | null;
  const pane = wrapper?.closest('[data-cy="viewport-pane"]') as HTMLElement | null;

  if (!wrapper) {
    return;
  }

  const barHeight = `${US_VIEWPORT_CINE_BAR_HEIGHT_PX}px`;
  const bottomReserve = `${US_VIEWPORT_BOTTOM_RESERVE_PX}px`;

  if (enabled) {
    wrapper.setAttribute('data-us-cine', 'true');
    wrapper.style.setProperty('--us-cine-bar-height', barHeight);
    wrapper.style.setProperty('--us-viewport-bottom-reserve', bottomReserve);
    pane?.setAttribute('data-us-cine', 'true');
    pane?.style.setProperty('--us-cine-bar-height', barHeight);
    pane?.style.setProperty('--us-viewport-bottom-reserve', bottomReserve);
    element.style.removeProperty('height');
  } else {
    wrapper.removeAttribute('data-us-cine');
    wrapper.style.removeProperty('--us-cine-bar-height');
    wrapper.style.removeProperty('--us-viewport-bottom-reserve');
    pane?.removeAttribute('data-us-cine');
    pane?.style.removeProperty('--us-cine-bar-height');
    pane?.style.removeProperty('--us-viewport-bottom-reserve');
    element.style.height = '100%';
  }

  window.requestAnimationFrame(() => {
    onResize?.();
    window.setTimeout(() => onResize?.(), 50);
  });
}
