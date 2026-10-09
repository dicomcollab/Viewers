/**
 * Alt+D opens the DICOM Tag Browser for the active viewport. Deliberately kept
 * out of the hotkey definitions so it does not appear in (or get overridden by)
 * the user-configurable shortcut list.
 */

let removeListener: (() => void) | null = null;

function isTypingTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element) {
    return false;
  }
  const tag = element.tagName;
  return (
    tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || element.isContentEditable === true
  );
}

function activeViewportHasDisplaySet(servicesManager: AppTypes.ServicesManager): boolean {
  const { viewportGridService } = servicesManager.services;
  const { activeViewportId, viewports } = viewportGridService.getState();
  return Boolean(viewports.get(activeViewportId)?.displaySetInstanceUIDs?.length);
}

export function installDicomTagBrowserHotkey(
  commandsManager: AppTypes.CommandsManager,
  servicesManager: AppTypes.ServicesManager
): void {
  uninstallDicomTagBrowserHotkey();

  const onKeyDown = (event: KeyboardEvent) => {
    // event.code, not event.key: on macOS Option+D types "∂".
    if (
      event.code !== 'KeyD' ||
      !event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      event.repeat ||
      isTypingTarget(event.target)
    ) {
      return;
    }

    // Stop the browser from focusing the address bar (Alt+D on Windows/Linux).
    event.preventDefault();
    event.stopPropagation();

    if (!activeViewportHasDisplaySet(servicesManager)) {
      return;
    }

    try {
      commandsManager.runCommand('openDICOMTagViewer', {});
    } catch (error) {
      console.warn('[DicomTagBrowserHotkey] Could not open DICOM Tag Browser:', error);
    }
  };

  window.addEventListener('keydown', onKeyDown, true);
  removeListener = () => window.removeEventListener('keydown', onKeyDown, true);
}

export function uninstallDicomTagBrowserHotkey(): void {
  removeListener?.();
  removeListener = null;
}
