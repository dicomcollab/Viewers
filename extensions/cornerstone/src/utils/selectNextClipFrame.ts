/**
 * Pick the next ultrasound clip frame to download.
 *
 * Never-downloaded frames come first. Otherwise a full image cache keeps
 * re-fetching evicted frames near the playhead and the remaining frames of the
 * clip never start (progress stuck e.g. at 157/167 while cine still plays).
 * Evicted frames about to play are filled in only after every frame has been
 * downloaded at least once (or when nothing new is left to request).
 */
function selectNextClipFrame(
  clip: {
    imageIds: { length: number };
    ready: boolean[];
    downloaded: boolean[];
    loaded: number;
    downloadedCount: number;
    inFlight: Set<number>;
    failed: Set<number>;
    retryAt: Map<number, number>;
  },
  viewerIndexes: number[],
  now: number,
  onRetryPending: (at: number) => void,
  lookahead: number
): number {
  const total = clip.imageIds.length;
  const canRequest = (index: number): boolean => {
    if (clip.ready[index] || clip.inFlight.has(index) || clip.failed.has(index)) {
      return false;
    }
    const retryAt = clip.retryAt.get(index);
    if (retryAt != null && retryAt > now) {
      onRetryPending(retryAt);
      return false;
    }
    return true;
  };

  for (let index = 0; index < total; index += 1) {
    if (!clip.downloaded[index] && canRequest(index)) {
      return index;
    }
  }

  if (clip.loaded < clip.downloadedCount) {
    for (const at of viewerIndexes) {
      const window = Math.min(total, Math.max(0, lookahead));
      for (let step = 0; step < window; step += 1) {
        const index = (((at + step) % total) + total) % total;
        if (clip.downloaded[index] && canRequest(index)) {
          return index;
        }
      }
    }
  }

  return -1;
}

export { selectNextClipFrame };
