// Shared state for zoom button tracking
let activeZoomButton: string | null = null;

export const setActiveZoomButton = (buttonId: string) => {
  activeZoomButton = buttonId;
};

export const getActiveZoomButton = (): string | null => {
  return activeZoomButton;
};

export const clearActiveZoomButton = () => {
  activeZoomButton = null;
};
