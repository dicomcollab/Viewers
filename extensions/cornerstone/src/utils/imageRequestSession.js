/**
 * In-flight DICOM image XHRs of the current study.
 *
 * Cornerstone's request pool frees a slot only when its request settles, and
 * clearRequestStack() (study switch) drops queued requests but not running ones.
 * A previous study's large downloads, or a connection that stopped sending,
 * therefore held the slots and the next study's frames were never requested.
 * - abortActiveImageRequests(): study switch — cancel everything still running.
 * - a request that receives nothing for STALL_TIMEOUT_MS is aborted so its slot
 *   is released; the frame is requested again when it is needed.
 */

const STALL_TIMEOUT_MS = 90_000;

const activeRequests = new Set();
let generation = 0;

/** Changes on every study switch; loads started under an older value are stale. */
function getImageRequestGeneration() {
  return generation;
}

function trackImageRequest(xhr, url) {
  activeRequests.add(xhr);

  let stallTimer = null;
  const clearStallTimer = () => {
    if (stallTimer) {
      clearTimeout(stallTimer);
      stallTimer = null;
    }
  };
  const armStallTimer = () => {
    clearStallTimer();
    stallTimer = setTimeout(() => {
      stallTimer = null;
      if (!activeRequests.has(xhr)) {
        return;
      }
      console.warn(
        `[imageRequestSession] No data for ${STALL_TIMEOUT_MS / 1000}s, aborting image request:`,
        url
      );
      try {
        xhr.abort();
      } catch {
        // Already finished.
      }
    }, STALL_TIMEOUT_MS);
  };

  xhr.addEventListener('readystatechange', armStallTimer);
  xhr.addEventListener('progress', armStallTimer);
  xhr.addEventListener('loadend', () => {
    clearStallTimer();
    activeRequests.delete(xhr);
  });
  armStallTimer();
}

/** Abort every image request still running. Returns how many were aborted. */
function abortActiveImageRequests() {
  generation += 1;
  const requests = Array.from(activeRequests);
  activeRequests.clear();
  requests.forEach(xhr => {
    try {
      xhr.abort();
    } catch {
      // Already finished.
    }
  });
  return requests.length;
}

export { abortActiveImageRequests, getImageRequestGeneration, trackImageRequest };
