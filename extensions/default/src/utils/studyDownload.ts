/**
 * Direct download of a study's original DICOM files as a ZIP (same flow as the RIS worklist).
 *
 * 1. GET {dicomApiRoot}/vault/download/plan asks the DICOM API how many files the ZIP will contain.
 * 2. A hidden iframe opens the download URL so the browser's own download manager saves the ZIP.
 *    An iframe cannot send an Authorization header, so the token goes in ?access_token=.
 */

export type StudyDownloadPlan = {
  fileCount?: number;
  filesWithoutLocation?: number;
};

const DOWNLOAD_IFRAME_REMOVE_MS = 300000;

type ViewerWindow = Window & {
  config?: { dicomApiRoot?: string };
  getViewerAccessBearerToken?: () => string | null;
};

function dicomApiRoot(): string {
  const root = String((window as ViewerWindow).config?.dicomApiRoot || '')
    .trim()
    .replace(/\/+$/, '');
  if (!root) {
    throw new Error('Study download is not configured (missing DICOM API URL).');
  }
  return root;
}

function getSessionToken(): string | null {
  const win = window as ViewerWindow;
  const token =
    typeof win.getViewerAccessBearerToken === 'function' ? win.getViewerAccessBearerToken() : null;
  return token?.trim() || null;
}

function dicomAuthHeaders(): Record<string, string> {
  const token = getSessionToken();
  return token ? { Authorization: `Bearer ${token}`, token } : {};
}

function studyDownloadUrl(studyInstanceUid: string): string {
  const url = new URL(
    `${dicomApiRoot()}/vault/download/study/${encodeURIComponent(studyInstanceUid)}`
  );
  const token = getSessionToken();
  if (token) {
    url.searchParams.set('access_token', token);
  }
  return url.toString();
}

function openInHiddenIframe(url: string): void {
  const iframe = document.createElement('iframe');
  iframe.style.cssText = 'position:fixed;width:0;height:0;border:0;visibility:hidden';
  iframe.setAttribute('aria-hidden', 'true');
  iframe.setAttribute('sandbox', 'allow-downloads');
  iframe.src = url;
  document.body.appendChild(iframe);
  window.setTimeout(() => iframe.remove(), DOWNLOAD_IFRAME_REMOVE_MS);
}

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const body = await response.json();
    if (body?.message) {
      return String(body.message);
    }
  } catch {
    /* non-JSON error body */
  }
  if (response.status === 401 || response.status === 403) {
    return 'You are not authorized to download this study. Sign in to RIS and try again.';
  }
  return `Download failed (HTTP ${response.status}). Please try again.`;
}

export async function fetchStudyDownloadPlan(studyInstanceUid: string): Promise<StudyDownloadPlan> {
  const url = new URL(`${dicomApiRoot()}/vault/download/plan`);
  url.searchParams.set('studyInstanceUid', studyInstanceUid);
  const response = await fetch(url.toString(), { headers: dicomAuthHeaders() });
  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }
  return response.json();
}

export async function startStudyDownload(studyInstanceUid: string): Promise<StudyDownloadPlan> {
  if (!studyInstanceUid) {
    throw new Error('Study Instance UID is missing for this study.');
  }
  const plan = await fetchStudyDownloadPlan(studyInstanceUid);
  const filesWithLocation = (plan?.fileCount ?? 0) - (plan?.filesWithoutLocation ?? 0);
  if (filesWithLocation <= 0) {
    throw new Error('No DICOM files found for this study.');
  }
  openInHiddenIframe(studyDownloadUrl(studyInstanceUid));
  return plan;
}

export function studyDownloadStartedMessage(plan: StudyDownloadPlan): string {
  const files = plan?.fileCount === 1 ? '1 file' : `${plan?.fileCount ?? 0} files`;
  const missing = plan?.filesWithoutLocation
    ? ` ${plan.filesWithoutLocation} without a storage location will be listed in MISSING_FILES.txt.`
    : '';
  return `Download started (${files}) — check your browser downloads.${missing}`;
}

export function studyDownloadErrorMessage(error: unknown): string {
  return (error as Error)?.message || 'Download failed. Please try again.';
}
