/**
 * Notify an open RIS report that key images changed for a study.
 * Uses BroadcastChannel (same-browser tabs) and postMessage (opener/parent).
 */

export const DICOMRIS_VIEWER_MSG_SOURCE = 'DICOMRIS_VIEWER';
export const DICOMRIS_KEY_IMAGES_UPDATED = 'KEY_IMAGES_UPDATED';
export const KEY_IMAGES_BROADCAST_CHANNEL = 'dicomris-key-images';

export type KeyImagesUpdatedPayload = {
  source: typeof DICOMRIS_VIEWER_MSG_SOURCE;
  type: typeof DICOMRIS_KEY_IMAGES_UPDATED;
  studyInstanceUID: string;
  action?: 'add' | 'remove' | 'reload';
};

function buildPayload(
  studyInstanceUID: string,
  action: KeyImagesUpdatedPayload['action'] = 'reload'
): KeyImagesUpdatedPayload {
  return {
    source: DICOMRIS_VIEWER_MSG_SOURCE,
    type: DICOMRIS_KEY_IMAGES_UPDATED,
    studyInstanceUID: String(studyInstanceUID || '').trim(),
    action,
  };
}

function postToWindow(target: Window | null | undefined, payload: KeyImagesUpdatedPayload) {
  if (!target || target === window) return;
  try {
    if ('closed' in target && target.closed) return;
  } catch {
    /* cross-origin closed check may throw */
  }
  try {
    target.postMessage(payload, '*');
  } catch {
    /* ignore */
  }
}

/** Tell RIS report windows that key images for this study changed. */
export function notifyRisKeyImagesUpdated(
  studyInstanceUID: string,
  action: KeyImagesUpdatedPayload['action'] = 'reload'
): void {
  const uid = String(studyInstanceUID || '').trim();
  if (!uid || typeof window === 'undefined') return;

  const payload = buildPayload(uid, action);

  try {
    const channel = new BroadcastChannel(KEY_IMAGES_BROADCAST_CHANNEL);
    channel.postMessage(payload);
    channel.close();
  } catch {
    /* BroadcastChannel unavailable */
  }

  try {
    postToWindow(window.opener, payload);
  } catch {
    /* ignore */
  }

  try {
    if (window.parent && window.parent !== window) {
      postToWindow(window.parent, payload);
    }
  } catch {
    /* ignore */
  }
}
