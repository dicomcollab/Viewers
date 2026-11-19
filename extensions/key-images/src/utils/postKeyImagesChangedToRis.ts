import type { KeyImageItem } from '../types';

export const KEY_IMAGES_CHANGED = 'KEY_IMAGES_CHANGED';
/** Matches existing viewer → RIS postMessage source (VIEWER_READY, layout prefs). */
export const MESSAGE_SOURCE_VIEWER = 'DICOMRIS_VIEWER';

type WireKeyImage = {
  id?: string;
  key?: string;
  url?: string;
  studyInstanceUID?: string;
  createdAt?: number;
};

function getRisAllowedOrigins(): string[] {
  const origins = new Set<string>();

  try {
    const cfg = (window as Window & { config?: { risPostMessage?: { allowedOrigins?: string[] }; risAuthSession?: { allowedOrigins?: string[] } } })
      .config;
    (cfg?.risPostMessage?.allowedOrigins || []).forEach(o => o && origins.add(o));
    (cfg?.risAuthSession?.allowedOrigins || []).forEach(o => o && origins.add(o));
  } catch {
    /* ignore */
  }

  try {
    if (document.referrer) {
      origins.add(new URL(document.referrer).origin);
    }
  } catch {
    /* ignore */
  }

  return [...origins];
}

function toWireItems(keyImages: KeyImageItem[]): WireKeyImage[] {
  return (Array.isArray(keyImages) ? keyImages : [])
    .map(item => ({
      id: item?.id,
      key: item?.s3Key || (item as { key?: string })?.key,
      url: item?.url || undefined,
      studyInstanceUID: item?.studyInstanceUID,
      createdAt: item?.createdAt,
    }))
    .filter(item => item.key || item.url || item.id);
}

/**
 * Notify the RIS opener/parent that study key images changed (add/delete/reload).
 * RIS fans out via BroadcastChannel so a sibling Report tab can live-update.
 */
export function postKeyImagesChangedToRis(
  studyInstanceUID: string,
  keyImages: KeyImageItem[]
): void {
  if (typeof window === 'undefined') return;
  const uid = String(studyInstanceUID || '').trim();
  if (!uid) return;

  const payload = {
    source: MESSAGE_SOURCE_VIEWER,
    type: KEY_IMAGES_CHANGED,
    studyInstanceUID: uid,
    keyImages: toWireItems(keyImages),
  };

  const targets: Window[] = [];
  try {
    if (window.opener && !window.opener.closed) {
      targets.push(window.opener);
    }
  } catch {
    /* cross-origin opener may throw */
  }
  try {
    if (window.parent && window.parent !== window) {
      targets.push(window.parent);
    }
  } catch {
    /* ignore */
  }
  if (!targets.length) return;

  const origins = getRisAllowedOrigins();
  const targetOrigins = origins.length ? origins : ['*'];

  for (const target of targets) {
    for (const origin of targetOrigins) {
      try {
        target.postMessage(payload, origin);
      } catch {
        /* ignore invalid target/origin pairs */
      }
    }
  }
}
