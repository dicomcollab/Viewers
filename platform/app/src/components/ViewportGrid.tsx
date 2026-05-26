import React, { useEffect, useCallback, useRef, useMemo, useState } from 'react';
import { Types } from '@ohif/core';
import { ViewportGrid, ViewportPane } from '@ohif/ui-next';
import { useViewportGrid } from '@ohif/ui-next';
import { useLocation } from 'react-router-dom';
import EmptyViewport from './EmptyViewport';
import { useAppConfig } from '@state';
type WadoUidKey = { studyUID: string | null; seriesUID: string | null; objectUID: string | null };

/** Normalize imageId for matching progress events to displaySet.images[].imageId */
function normalizeImageIdForProgressMatch(imageId?: string | null) {
  if (!imageId || typeof imageId !== 'string') {
    return '';
  }
  return imageId
    .replace(/^dicomweb-jpeg:/i, '')
    .replace(/^dicomweb:/i, '')
    .replace(/^wadors:/i, '')
    .replace(/^wadouri:/i, '')
    .split('&frame=')[0];
}

function normalizeImageIdToUrl(imageId?: string) {
  if (!imageId || typeof imageId !== 'string') {
    return null;
  }

  const idx = imageId.indexOf(':');
  const proto = idx > -1 ? imageId.slice(0, idx) : null;
  const hasKnownPrefix =
    proto && ['dicomweb', 'dicomweb-jpeg', 'wadouri', 'wadors'].includes(proto);
  let url = hasKnownPrefix ? imageId.slice(idx + 1) : imageId;
  if (url.startsWith('//')) {
    url = url.slice(2);
  }
  return url || null;
}

/**
 * Match XHR request URLs to displaySet imageIds when WADO-RS-style UIDs are not in the URL
 * (e.g. Azure Blob: path + SAS query only). Ignores query strings so tokens can differ.
 */
function normalizeUrlPathForProgressMatch(url: string | null | undefined): string | null {
  if (!url || typeof url !== 'string') {
    return null;
  }
  try {
    const parsed = new URL(url, 'http://ohif.local');
    let path = parsed.pathname;
    try {
      path = decodeURIComponent(path);
    } catch {
      // keep raw pathname
    }
    return `${parsed.origin}${path}`.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Pathname-only match for DICOMweb/WADO-RS (e.g. …/instances/{sop}/frames/1). Resolves relative
 * XHR URLs against the app origin so they still match absolute wadors: imageIds (cross-origin API).
 */
function normalizeDicomRequestPathname(url: string | null | undefined): string | null {
  if (!url || typeof url !== 'string') {
    return null;
  }
  try {
    const base =
      typeof window !== 'undefined' && window.location?.origin
        ? window.location.origin
        : 'https://ohif.local';
    const parsed = new URL(url, base);
    let path = parsed.pathname;
    try {
      path = decodeURIComponent(path);
    } catch {
      // keep
    }
    return path.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * After the main instance XHR hits 100%, dicom-image-loader may open another GET (same URL match).
 * Those requests re-dispatch progress 0 and would snap the bar back — keep progress monotonic until
 * the viewport target is reset or the first frame is painted.
 */
function mergeMonotonicViewportByteProgress(
  prev: Record<string, number | null>,
  viewportId: string,
  incoming: number
): Record<string, number | null> {
  const cur = prev[viewportId];
  if (typeof cur === 'number' && !Number.isNaN(cur) && incoming < cur) {
    return prev;
  }
  return { ...prev, [viewportId]: incoming };
}

/**
 * WADO-RS / DICOMweb retrieve frame URLs (e.g. DICOMcloud):
 * .../studies/{studyUID}/series/{seriesUID}/instances/{sopUID}/frames/1
 */
function extractWadoUidsFromDicomWebPath(url: string): WadoUidKey | null {
  const m = url.match(/\/studies\/([^/]+)\/series\/([^/]+)\/instances\/([^/]+)/i);
  if (!m) {
    return null;
  }
  try {
    return {
      studyUID: decodeURIComponent(m[1]),
      seriesUID: decodeURIComponent(m[2]),
      objectUID: decodeURIComponent(m[3]),
    };
  } catch {
    return {
      studyUID: m[1],
      seriesUID: m[2],
      objectUID: m[3],
    };
  }
}

function extractWadoUids(url: string | null) {
  if (!url || typeof url !== 'string') {
    return null;
  }

  try {
    // Use a dummy base to handle relative URLs.
    const parsed = new URL(url, 'http://ohif.local');
    const params = parsed.searchParams;
    const studyUID = params.get('studyUID') || params.get('studyInstanceUID') || null;
    const seriesUID = params.get('seriesUID') || null;
    const objectUID = params.get('objectUID') || params.get('sopInstanceUID') || null;
    if (studyUID || seriesUID || objectUID) {
      return { studyUID, seriesUID, objectUID };
    }
    const fromPath = extractWadoUidsFromDicomWebPath(parsed.pathname + parsed.search);
    if (fromPath) {
      return fromPath;
    }
    return extractWadoUidsFromDicomWebPath(url);
  } catch {
    // Fallback: quick parsing for strings that aren't valid URLs.
    const get = (key: string) => {
      const m = url.match(new RegExp(`[?&]${key}=([^&]+)`));
      return m ? decodeURIComponent(m[1]) : null;
    };
    const studyUID = get('studyUID') || get('studyInstanceUID');
    const seriesUID = get('seriesUID');
    const objectUID = get('objectUID') || get('sopInstanceUID');
    if (studyUID || seriesUID || objectUID) {
      return { studyUID, seriesUID, objectUID };
    }
    return extractWadoUidsFromDicomWebPath(url);
  }
}

function isVolumeLikeViewport(viewportOptions: any) {
  const viewportType = viewportOptions?.viewportType;
  if (typeof viewportType !== 'string') {
    return false;
  }

  // Common OHIF/CS viewport types: 'stack', 'volume', 'orthographic', etc.
  return viewportType.toLowerCase().includes('volume') || viewportType.toLowerCase().includes('orthographic');
}

function doesUidMatch(targetKey: WadoUidKey | null, requestKey: WadoUidKey | null) {
  if (!targetKey || !requestKey) {
    return false;
  }

  const isSameObject =
    targetKey.objectUID && requestKey.objectUID && targetKey.objectUID === requestKey.objectUID;
  const isSameSeries =
    !targetKey.seriesUID || !requestKey.seriesUID || targetKey.seriesUID === requestKey.seriesUID;
  const isSameStudy =
    !targetKey.studyUID || !requestKey.studyUID || targetKey.studyUID === requestKey.studyUID;

  return Boolean(isSameObject && isSameSeries && isSameStudy);
}

type ViewportFirstTargetRef = {
  targetImageId: string | null;
  targetUrl: string | null;
  stackImageIds: string[];
  primaryDisplaySetUid: string;
  /** First-instance SOP when imageIds are not ready yet — stabilizes /frames/ matching */
  primarySopInstanceUID?: string | null;
};

/** imageIds is set on the display set in CornerstoneCacheService before images[] is hydrated — prefer it. */
function collectImageIdsFromDisplaySet(displaySet: any): string[] {
  if (!displaySet) {
    return [];
  }
  const out: string[] = [];
  if (Array.isArray(displaySet.imageIds)) {
    for (const id of displaySet.imageIds) {
      if (id && typeof id === 'string') {
        out.push(id);
      }
    }
  }
  if (Array.isArray(displaySet.images)) {
    for (const im of displaySet.images) {
      if (im?.imageId && typeof im.imageId === 'string') {
        out.push(im.imageId);
      }
    }
  }
  return [...new Set(out)];
}

function getPrimaryStackImageId(displaySet: any): string | null {
  if (!displaySet) {
    return null;
  }
  if (Array.isArray(displaySet.imageIds) && displaySet.imageIds.length > 0) {
    const id = displaySet.imageIds[0];
    return typeof id === 'string' ? id : null;
  }
  if (Array.isArray(displaySet.images) && displaySet.images.length > 0) {
    const id = displaySet.images[0]?.imageId;
    return typeof id === 'string' ? id : null;
  }
  return null;
}

function getPrimarySopUidFromDisplaySet(displaySet: any): string | null {
  if (!displaySet) {
    return null;
  }
  if (typeof displaySet.SOPInstanceUID === 'string') {
    return displaySet.SOPInstanceUID;
  }
  const inst0 = Array.isArray(displaySet.instances) ? displaySet.instances[0] : null;
  if (inst0 && typeof inst0.SOPInstanceUID === 'string') {
    return inst0.SOPInstanceUID;
  }
  const img0 = Array.isArray(displaySet.images) ? displaySet.images[0] : null;
  if (img0 && typeof img0.SOPInstanceUID === 'string') {
    return img0.SOPInstanceUID;
  }
  return null;
}

/** SR viewports render text/measurements, not cornerstone stack images — no IMAGE_RENDERED. */
function isStructuredReportDisplaySet(displaySet: any): boolean {
  if (!displaySet) {
    return false;
  }
  if (displaySet.Modality === 'SR') {
    return true;
  }
  const handlerId = displaySet.SOPClassHandlerId;
  return typeof handlerId === 'string' && handlerId.includes('dicom-sr');
}

function viewportHasOnlyStructuredReportDisplaySets(displaySets: any[]): boolean {
  return displaySets.length > 0 && displaySets.every(isStructuredReportDisplaySet);
}

/** Match dicom-image-loader / Cornerstone imageId to the viewport showing that stack instance. */
function findMatchingViewportIdsForImageId(
  imageId: string,
  targets: Record<string, ViewportFirstTargetRef>
): string[] {
  if (!imageId || typeof imageId !== 'string') {
    return [];
  }
  const eventKey = normalizeImageIdForProgressMatch(imageId);
  const eventPathKey = normalizeUrlPathForProgressMatch(normalizeImageIdToUrl(imageId) || imageId);
  const eventObjectUid = extractWadoUids(normalizeImageIdToUrl(imageId) || imageId)?.objectUID;
  return Object.keys(targets).filter(viewportId => {
    const stackIds = targets[viewportId]?.stackImageIds;
    if (
      Array.isArray(stackIds) &&
      stackIds.some(
        sid => sid === imageId || normalizeImageIdForProgressMatch(sid) === eventKey
      )
    ) {
      return true;
    }
    const t = targets[viewportId]?.targetImageId;
    if (t === imageId || normalizeImageIdForProgressMatch(t) === eventKey) {
      return true;
    }
    const pSop = targets[viewportId]?.primarySopInstanceUID;
    if (eventObjectUid && pSop && eventObjectUid === pSop) {
      return true;
    }
    const tu = targets[viewportId]?.targetUrl;
    if (!tu) {
      return false;
    }
    const tuPath = normalizeUrlPathForProgressMatch(tu);
    const imgUrlForPath = normalizeImageIdToUrl(imageId) || imageId;
    const pathKeysMatch = Boolean(eventPathKey && tuPath && eventPathKey === tuPath);
    const pnEvent =
      typeof imgUrlForPath === 'string' ? normalizeDicomRequestPathname(imgUrlForPath) : null;
    const pnTarget = normalizeDicomRequestPathname(tu);
    const pathnameMatch = Boolean(pnEvent && pnTarget && pnEvent === pnTarget);
    if (!pathKeysMatch && !pathnameMatch) {
      return false;
    }
    const wadouriKey = eventPathKey || (pnEvent ? `https://ohif.local${pnEvent}` : '');
    if (pathnameEndsWithWadouriSegment(wadouriKey) || pathnameEndsWithWadouriSegment(tu)) {
      const primaryObj = extractWadoUids(tu)?.objectUID;
      return Boolean(eventObjectUid && primaryObj && eventObjectUid === primaryObj);
    }
    return true;
  });
}

/** When ref targets are stale, map XHR uri (no scheme) or full imageId to a viewport by scanning display sets. */
function findViewportsByDicomLoaderUrl(
  loadUrl: string | undefined,
  imageId: string | undefined,
  ctx: { viewports?: Map<string, any>; displaySetService?: any } | null
): string[] {
  const loadPathKey =
    normalizeUrlPathForProgressMatch(loadUrl) ||
    normalizeUrlPathForProgressMatch(normalizeImageIdToUrl(imageId || '') || imageId || '');
  const loadPathname =
    normalizeDicomRequestPathname(loadUrl) ||
    normalizeDicomRequestPathname(normalizeImageIdToUrl(imageId || '') || imageId || '');
  if ((!loadPathKey && !loadPathname) || !ctx?.viewports || !ctx?.displaySetService?.getDisplaySetByUID) {
    return [];
  }
  const found: string[] = [];
  for (const vp of ctx.viewports.values()) {
    const viewportId = vp?.viewportOptions?.viewportId;
    if (!viewportId) {
      continue;
    }
    const uids: string[] = vp?.displaySetInstanceUIDs || [];
    for (const uid of uids) {
      const ds = ctx.displaySetService.getDisplaySetByUID(uid);
      if (!ds || ds.unsupported) {
        continue;
      }
      const ids = collectImageIdsFromDisplaySet(ds);
      for (const id of ids) {
        const u = normalizeImageIdToUrl(id) || id;
        if (!u) {
          continue;
        }
        if (loadPathKey && normalizeUrlPathForProgressMatch(u) === loadPathKey) {
          found.push(viewportId);
          break;
        }
        if (loadPathname) {
          const idPn = normalizeDicomRequestPathname(u);
          if (idPn && idPn === loadPathname) {
            found.push(viewportId);
            break;
          }
        }
      }
    }
  }
  return [...new Set(found)];
}

/** Study / Series / SOP UIDs from a display set (for Azure-style paths that embed UIDs in segments). */
function collectDicomUidsFromDisplaySet(displaySet: any): Set<string> {
  const out = new Set<string>();
  const add = (v: unknown) => {
    if (typeof v === 'string' && v.includes('.') && /^\d+(?:\.\d+)+$/.test(v)) {
      out.add(v);
    }
  };
  add(displaySet?.StudyInstanceUID);
  add(displaySet?.SeriesInstanceUID);
  const instances = displaySet?.instances;
  if (Array.isArray(instances)) {
    for (const inst of instances) {
      add(inst?.SOPInstanceUID);
      add(inst?.StudyInstanceUID);
      add(inst?.SeriesInstanceUID);
    }
  }
  return out;
}

/** Pull dotted DICOM UID-like tokens from a request URL (pathname + search), decoded. */
function extractDicomUidTokensFromUrl(url: string | null | undefined): string[] {
  if (!url || typeof url !== 'string') {
    return [];
  }
  try {
    const parsed = new URL(url, 'http://ohif.local');
    let blob = `${parsed.pathname}${parsed.search}`;
    try {
      blob = decodeURIComponent(blob);
    } catch {
      // keep encoded
    }
    const matches = blob.match(/\d+(?:\.\d+){2,}/g);
    return matches ? [...new Set(matches)] : [];
  } catch {
    return [];
  }
}

/**
 * Match XHR / loader URL to viewports when path keys differ (encoding, gateway, redirect)
 * but the URL path still contains Study/Series/SOP UIDs (common for Azure blob layouts).
 */
function findViewportsByUidTokensInRequestUrl(
  requestUrl: string | null | undefined,
  ctx: { viewports?: Map<string, any>; displaySetService?: any } | null
): string[] {
  const tokens = extractDicomUidTokensFromUrl(requestUrl);
  if (!tokens.length || !ctx?.viewports || !ctx?.displaySetService?.getDisplaySetByUID) {
    return [];
  }
  const found: string[] = [];
  for (const vp of ctx.viewports.values()) {
    const viewportId = vp?.viewportOptions?.viewportId;
    if (!viewportId) {
      continue;
    }
    const dsUidsList: string[] = vp?.displaySetInstanceUIDs || [];
    for (const dsUid of dsUidsList) {
      const ds = ctx.displaySetService.getDisplaySetByUID(dsUid);
      if (!ds || ds.unsupported) {
        continue;
      }
      const set = collectDicomUidsFromDisplaySet(ds);
      if (tokens.some(t => set.has(t))) {
        found.push(viewportId);
        break;
      }
    }
  }
  return [...new Set(found)];
}

/**
 * Match a request URL to viewports only when objectUID (SOP Instance UID) equals that viewport's
 * primary stack image. Avoids matching every viewport that shares the same study/series (321 instances).
 */
function findViewportsByPrimarySopInRequestUrl(
  requestUrl: string | null | undefined,
  targets: Record<string, ViewportFirstTargetRef>
): string[] {
  const req = extractWadoUids(requestUrl || '');
  if (!req?.objectUID) {
    return [];
  }
  const found: string[] = [];
  for (const viewportId of Object.keys(targets)) {
    const t = targets[viewportId];
    const tu = t?.targetUrl;
    const pk = tu ? extractWadoUids(tu) : null;
    const metaSop = t?.primarySopInstanceUID;
    const targetSop = pk?.objectUID || metaSop;
    if (targetSop && targetSop === req.objectUID) {
      found.push(viewportId);
    }
  }
  return [...new Set(found)];
}

/**
 * Same display set in multiple viewports (e.g. MPR triptych): findMatchingViewportIdsForImageId returns
 * every pane. Loader skeleton should track a single viewport — prefer the active one.
 */
function narrowMatchingViewportsForLoaderUi(
  matchingViewportIds: string[],
  targets: Record<string, ViewportFirstTargetRef>,
  activeViewportId: string | null | undefined
): string[] {
  if (matchingViewportIds.length <= 1) {
    return matchingViewportIds;
  }
  const dsKeys = matchingViewportIds
    .map(id => targets[id]?.primaryDisplaySetUid || '')
    .filter(Boolean);
  const uniqueDs = new Set(dsKeys);
  const allSameDisplaySet =
    dsKeys.length === matchingViewportIds.length && uniqueDs.size === 1 && dsKeys[0] !== '';
  if (!allSameDisplaySet) {
    return matchingViewportIds;
  }
  if (activeViewportId && matchingViewportIds.includes(activeViewportId)) {
    return [activeViewportId];
  }
  return [matchingViewportIds[0]];
}

/**
 * Post-redirect (or SAS) byte delivery URL — not the DICOMweb /instances/.../frames/1 API hop that
 * redirects to blob (localviewer-raw-dicom).
 */
function isLikelyFinalDicomBytesUrl(url: string | null | undefined): boolean {
  if (!url || typeof url !== 'string') {
    return false;
  }
  const u = url.toLowerCase();
  if (u.includes('blob.core.windows.net')) {
    return true;
  }
  if (u.includes('application-dicom') || u.includes('application%2ddicom')) {
    return true;
  }
  if (
    u.includes('application-octet-stream') &&
    (u.includes('blob.core.windows.net') || (u.includes('sv=') && u.includes('sig=')))
  ) {
    return true;
  }
  if (u.includes('application%2doctet-stream') && u.includes('sv=') && u.includes('sig=')) {
    return true;
  }
  if (u.includes('sv=') && u.includes('sig=')) {
    return true;
  }
  return false;
}

function isWadoGatewayUrl(url: string | null | undefined): boolean {
  if (!url || typeof url !== 'string') {
    return false;
  }
  const u = url.toLowerCase();
  return u.includes('wadouri') || u.includes('requesttype=wado');
}

/**
 * WADO-RS …/instances/{sop}/frames/{n} — actual pixel GET (same host or 302 to blob).
 * Must not be treated as a "skip loader start" hop (see handleDicomLoaderXhr phase start).
 */
function isWadoRsDirectFramePixelUrl(url: string | null | undefined): boolean {
  if (!url || typeof url !== 'string') {
    return false;
  }
  return /\/frames\/\d+/i.test(url);
}

function isWadoRsApiRedirectHopUrl(url: string | null | undefined): boolean {
  if (!url || typeof url !== 'string') {
    return false;
  }
  if (isLikelyFinalDicomBytesUrl(url)) {
    return false;
  }
  if (isWadoRsDirectFramePixelUrl(url)) {
    return false;
  }
  const u = url.toLowerCase();
  return u.includes('/instances/') || u.includes('/bulkdata/') || u.includes('/frames/');
}

function isMultiHopDicomProgressRequestUrl(url: string | null | undefined): boolean {
  return isWadoGatewayUrl(url) || isWadoRsApiRedirectHopUrl(url);
}

function shouldDeferFirstImageLoaderUntilBlobPhase(targetUrl: string | null | undefined): boolean {
  return isMultiHopDicomProgressRequestUrl(targetUrl);
}

/** First stack image of this viewport (initial series instance) — not scroll/prefetch of other slices. */
function isViewportPrimaryStackImageId(
  imageId: string,
  viewportId: string,
  targets: Record<string, ViewportFirstTargetRef>
): boolean {
  const t = targets[viewportId];
  if (!t) {
    return false;
  }
  const eventKey = normalizeImageIdForProgressMatch(imageId);
  const primaryId = t.targetImageId;
  if (
    primaryId &&
    (primaryId === imageId || normalizeImageIdForProgressMatch(primaryId) === eventKey)
  ) {
    return true;
  }
  const firstStack = Array.isArray(t.stackImageIds) && t.stackImageIds[0];
  if (
    firstStack &&
    (firstStack === imageId || normalizeImageIdForProgressMatch(firstStack) === eventKey)
  ) {
    return true;
  }
  const primaryUrl = t.targetUrl;
  const imgUrl = normalizeImageIdToUrl(imageId) || imageId;
  if (typeof imgUrl === 'string' && primaryUrl) {
    const pn1 = normalizeDicomRequestPathname(imgUrl);
    const pn2 = normalizeDicomRequestPathname(primaryUrl);
    if (pn1 && pn2 && pn1 === pn2) {
      return true;
    }
  }
  const evtSop = extractWadoUids(typeof imgUrl === 'string' ? imgUrl : '')?.objectUID;
  const metaSop = t.primarySopInstanceUID;
  if (evtSop && metaSop && evtSop === metaSop) {
    return true;
  }
  return false;
}

function pathnameEndsWithWadouriSegment(pathKey: string | null | undefined): boolean {
  if (!pathKey || typeof pathKey !== 'string') {
    return false;
  }
  try {
    const u = new URL(pathKey.includes('://') ? pathKey : `https://ohif.local${pathKey}`);
    const segments = u.pathname.split('/').filter(Boolean);
    const last = segments[segments.length - 1]?.toLowerCase() || '';
    return last === 'wadouri';
  } catch {
    return pathKey.toLowerCase().includes('wadouri');
  }
}

function isByteRequestForPrimarySopInstance(
  url: string | null | undefined,
  viewportId: string,
  targets: Record<string, ViewportFirstTargetRef>
): boolean {
  if (!url || typeof url !== 'string') {
    return false;
  }
  const t = targets[viewportId];
  const primaryUrl = t?.targetUrl;
  const rk = extractWadoUids(url);
  if (!rk?.objectUID) {
    return false;
  }
  const metaSop = t?.primarySopInstanceUID;
  if (metaSop && rk.objectUID === metaSop) {
    return true;
  }
  if (!primaryUrl) {
    return false;
  }
  const pk = extractWadoUids(primaryUrl);
  if (pk?.objectUID && rk?.objectUID && pk.objectUID === rk.objectUID) {
    return true;
  }
  const pkPath = normalizeUrlPathForProgressMatch(primaryUrl);
  const rkPath = normalizeUrlPathForProgressMatch(url);
  // WADO-URI: path is usually …/wadouri for every instance; only objectUID in the query differs.
  // Path-only equality incorrectly marks every slice as "primary".
  if (
    pkPath &&
    rkPath &&
    pkPath === rkPath &&
    (pathnameEndsWithWadouriSegment(pkPath) || pathnameEndsWithWadouriSegment(rkPath))
  ) {
    return false;
  }
  return Boolean(pkPath && rkPath && pkPath === rkPath);
}

/** WADO XHR: primary instance only — never treat every blob/SAS response as primary (was blanketing MPR viewports). */
function isLikelyPrimaryInstanceBytesDelivery(
  requestUrl: string,
  responseURL: string | undefined,
  viewportId: string,
  targets: Record<string, ViewportFirstTargetRef>
): boolean {
  const t = targets[viewportId];
  if (!t?.targetUrl && !t?.primarySopInstanceUID) {
    return false;
  }
  if (isByteRequestForPrimarySopInstance(requestUrl, viewportId, targets)) {
    return true;
  }
  if (responseURL && isByteRequestForPrimarySopInstance(responseURL, viewportId, targets)) {
    return true;
  }
  return false;
}

/** Same heuristics as initWADOImageLoader — attribute orphan byte-XHRs to the active stack viewport when needed. */
function isLikelyDicomInstanceByteGetUrl(url: string | null | undefined): boolean {
  if (!url || typeof url !== 'string') {
    return false;
  }
  const u = url.toLowerCase();
  if (u.includes('wadouri') || u.includes('requesttype=wado') || u.includes('objectuid=')) {
    return true;
  }
  if (u.includes('/instances/') || u.includes('/bulkdata/') || u.includes('/frames/')) {
    return true;
  }
  if (
    u.includes('contenttype=application%2fdicom') ||
    u.includes('contenttype=application/dicom') ||
    u.includes('octet-stream') ||
    u.includes('application%2foctet-stream')
  ) {
    return true;
  }
  if (u.includes('sv=') && u.includes('st=')) {
    return true;
  }
  if (u.includes('blob.core.windows.net') && u.includes('dicom')) {
    return true;
  }
  if (u.includes('application-dicom') || u.includes('application%2ddicom')) {
    return true;
  }
  return false;
}

function ViewerViewportGrid(props: withAppTypes) {
  const { servicesManager, viewportComponents = [], dataSource, commandsManager } = props;
  const [viewportGrid, viewportGridService] = useViewportGrid();
  const [appConfig] = useAppConfig();

  const { layout, activeViewportId, viewports, isHangingProtocolLayout } = viewportGrid;
  const { numCols, numRows } = layout;
  const layoutHash = useRef(null);
  const viewportsProgressRef = useRef<{ viewports: Map<string, any> | null; displaySetService: any }>({
    viewports: null,
    displaySetService: null,
  });

  const { displaySetService, hangingProtocolService, uiNotificationService, customizationService, studyPrefetcherService } =
    servicesManager.services;

  viewportsProgressRef.current = { viewports, displaySetService };

  const activeViewportIdRef = useRef(activeViewportId);
  activeViewportIdRef.current = activeViewportId;

  const generateLayoutHash = () => `${numCols}-${numRows}`;

  /**
   * This callback runs after the viewports structure has changed in any way.
   * On initial display, that means if it has changed by applying a HangingProtocol,
   * while subsequently it may mean by changing the stage or by manually adjusting
   * the layout.

   */
  const updateDisplaySetsFromProtocol = (
    _protocol: Types.HangingProtocol.Protocol,
    stage,
    _activeStudyUID,
    viewportMatchDetails
  ) => {
    const availableDisplaySets = displaySetService.getActiveDisplaySets();

    if (!availableDisplaySets.length) {
      console.log('No available display sets', availableDisplaySets);
      return;
    }

    // Match each viewport individually
    const { layoutType } = stage.viewportStructure;
    const stageProps = stage.viewportStructure.properties;
    const { columns: numCols, rows: numRows, layoutOptions = [] } = stageProps;

    /**
     * This find or create viewport uses the hanging protocol results to
     * specify the viewport match details, which specifies the size and
     * setup of the various viewports.
     */
    const findOrCreateViewport = pos => {
      const viewportId = Array.from(viewportMatchDetails.keys())[pos];
      const details = viewportMatchDetails.get(viewportId);
      if (!details) {
        console.log('No match details for viewport', viewportId);
        return;
      }

      const { displaySetsInfo, viewportOptions } = details;
      const displaySetUIDsToHang = [];
      const displaySetUIDsToHangOptions = [];

      displaySetsInfo.forEach(({ displaySetInstanceUID, displaySetOptions }) => {
        if (displaySetInstanceUID) {
          displaySetUIDsToHang.push(displaySetInstanceUID);
        }

        displaySetUIDsToHangOptions.push(displaySetOptions);
      });

      const computedViewportOptions = hangingProtocolService.getComputedOptions(
        viewportOptions,
        displaySetUIDsToHang
      );

      const computedDisplaySetOptions = hangingProtocolService.getComputedOptions(
        displaySetUIDsToHangOptions,
        displaySetUIDsToHang
      );

      return {
        displaySetInstanceUIDs: displaySetUIDsToHang,
        displaySetOptions: computedDisplaySetOptions,
        viewportOptions: computedViewportOptions,
      };
    };

    viewportGridService.setLayout({
      numRows,
      numCols,
      layoutType,
      layoutOptions,
      findOrCreateViewport,
      isHangingProtocolLayout: true,
    });
  };

  const _getUpdatedViewports = useCallback(
    (viewportId, displaySetInstanceUID) => {
      if (!displaySetInstanceUID) {
        return [];
      }

      let updatedViewports = [];
      try {
        updatedViewports = hangingProtocolService.getViewportsRequireUpdate(
          viewportId,
          displaySetInstanceUID,
          isHangingProtocolLayout
        );
      } catch (error) {
        console.warn(error);
        uiNotificationService.show({
          title: 'Drag and Drop',
          message:
            'The selected display sets could not be added to the viewport due to a mismatch in the Hanging Protocol rules.',
          type: 'error',
          duration: 3000,
        });
      }

      return updatedViewports;
    },
    [hangingProtocolService, uiNotificationService, isHangingProtocolLayout]
  );

  // Using Hanging protocol engine to match the displaySets
  useEffect(() => {
    const { unsubscribe } = hangingProtocolService.subscribe(
      hangingProtocolService.EVENTS.PROTOCOL_CHANGED,
      ({ protocol, stage, activeStudyUID, viewportMatchDetails }) => {
        updateDisplaySetsFromProtocol(protocol, stage, activeStudyUID, viewportMatchDetails);
      }
    );

    return () => {
      unsubscribe();
    };
  }, []);

  // Check viewport readiness in useEffect
  useEffect(() => {
    const allReady = viewportGridService.getGridViewportsReady();
    const sameLayoutHash = layoutHash.current === generateLayoutHash();
    if (allReady && !sameLayoutHash) {
      layoutHash.current = generateLayoutHash();
      viewportGridService.publishViewportsReady();
    }
  }, [viewportGridService, generateLayoutHash]);

  const onDropHandler = (viewportId, { displaySetInstanceUID }) => {
    const { viewportGridService } = servicesManager.services;
    const customOnDropHandler = customizationService.getCustomization('customOnDropHandler');
    const dropHandlerPromise = customOnDropHandler({
      ...props,
      viewportId,
      displaySetInstanceUID,
      appConfig,
    });
    dropHandlerPromise.then(({ handled }) => {
      if (!handled) {
        const updatedViewports = _getUpdatedViewports(viewportId, displaySetInstanceUID);

        commandsManager.run('setDisplaySetsForViewports', { viewportsToUpdate: updatedViewports });
      }
    });
    viewportGridService.publishViewportOnDropHandled({ displaySetInstanceUID });
  };

  /**
   * Show a simple loading state when an advanced layout (MPR, 3D, etc.) is applied
   * and viewport data is still loading. Not the full-screen OHIF default loader.
   */
  const hasPendingHPViewports = useMemo(() => {
    if (!isHangingProtocolLayout || !viewports?.size) {
      return false;
    }
    for (const vp of viewports.values()) {
      if (vp.displaySetInstanceUIDs?.length && vp.isReady === false) {
        return true;
      }
    }
    return false;
  }, [isHangingProtocolLayout, viewports]);

  // Debounce the overlay so it doesn't flash for instant cached switches.
  const [layoutLoading, setLayoutLoading] = useState(false);
  const [hasRenderedAnyViewport, setHasRenderedAnyViewport] = useState(false);
  const location = useLocation();
  const firstLoadScopeKey = useMemo(() => {
    const params = new URLSearchParams(location?.search || '');
    const studyUIDs =
      params.get('studyInstanceUIDs') ||
      params.get('StudyInstanceUIDs') ||
      params.get('studyInstanceUID') ||
      params.get('StudyInstanceUID') ||
      '';
    const dataSourceName = params.get('datasources') || '';
    return `${studyUIDs}|${dataSourceName}`;
  }, [location?.search]);
  const [viewportLoadingState, setViewportLoadingState] = useState({});
  const [viewportFirstImageRenderedById, setViewportFirstImageRenderedById] = useState<Record<string, boolean>>({});
  const [viewportFirstImageDownloadedById, setViewportFirstImageDownloadedById] = useState<Record<string, boolean>>({});
  // User requirement: show the "Loading images..." overlay only for the initial
  // first image of the first series shown in a viewport, not on subsequent series changes.
  const [viewportInitialFirstImageCompleteById, setViewportInitialFirstImageCompleteById] = useState<
    Record<string, boolean>
  >({});
  const [viewportByteProgressById, setViewportByteProgressById] = useState<Record<string, number | null>>({});
  const [viewportIsProgressComputableById, setViewportIsProgressComputableById] = useState<Record<string, boolean>>({});
  const [viewportInFlightById, setViewportInFlightById] = useState<Record<string, boolean>>({});
  const [viewportLoadLoadedBytesById, setViewportLoadLoadedBytesById] = useState<Record<string, number>>({});
  /** After the first stack instance finishes downloading, never show the "Downloading image…" skeleton again (scroll/prefetch). */
  const [viewportFirstInstanceDownloadSkeletonDoneById, setViewportFirstInstanceDownloadSkeletonDoneById] = useState<
    Record<string, boolean>
  >({});
  const viewportFirstInstanceSkeletonLatchRef = useRef<Record<string, boolean>>({});
  const markViewportFirstInstanceSkeletonDoneRef = useRef<(viewportId: string) => void>(() => {});
  /** WADO-URI gateway stacks: hide the overlay until the redirected blob/instance byte request is active. */
  const [viewportBlobPhaseStartedById, setViewportBlobPhaseStartedById] = useState<Record<string, boolean>>({});

  /**
   * IMAGE_RENDERED can fire before the WADO→blob XHR finishes, which used to remove this overlay
   * immediately. Hide the overlay only after first paint AND first-instance bytes are done (or no
   * tracked XHR ran, e.g. cache/local).
   */
  const viewportFirstPaintedRef = useRef<Record<string, boolean>>({});
  const viewportFirstBytesCompleteRef = useRef<Record<string, boolean>>({});
  const viewportFirstEverInFlightRef = useRef<Record<string, boolean>>({});
  const viewportFirstOverlayGuardTimersRef = useRef<Record<string, number>>({});
  const prevFirstLoadScopeKeyRef = useRef(firstLoadScopeKey);

  const markViewportFirstInstanceSkeletonDone = useCallback((viewportId: string) => {
    if (!viewportId) {
      return;
    }
    viewportFirstInstanceSkeletonLatchRef.current[viewportId] = true;
    setViewportFirstInstanceDownloadSkeletonDoneById(prev =>
      prev[viewportId] ? prev : { ...prev, [viewportId]: true }
    );
  }, []);
  markViewportFirstInstanceSkeletonDoneRef.current = markViewportFirstInstanceSkeletonDone;

  // Reset first-image skeleton eligibility when study/datasource scope changes.
  // This preserves suppression during advanced layout switches in the same study.
  useEffect(() => {
    if (prevFirstLoadScopeKeyRef.current === firstLoadScopeKey) {
      return;
    }
    prevFirstLoadScopeKeyRef.current = firstLoadScopeKey;
    setHasRenderedAnyViewport(false);
  }, [firstLoadScopeKey]);

  const tryFinalizeFirstViewportOverlay = useCallback((viewportId: string) => {
    if (!viewportFirstPaintedRef.current[viewportId]) {
      return;
    }
    const targetUrl = viewportFirstTargetsRef.current?.[viewportId]?.targetUrl;
    const deferredGateway = shouldDeferFirstImageLoaderUntilBlobPhase(targetUrl);
    const ever = viewportFirstEverInFlightRef.current[viewportId];
    const bytesDone = viewportFirstBytesCompleteRef.current[viewportId];
    // Gateway→blob: never dismiss on first paint alone; wait for real instance bytes (or loader end).
    if (deferredGateway) {
      if (!bytesDone) {
        return;
      }
    } else if (ever && !bytesDone) {
      return;
    }
    setViewportInitialFirstImageCompleteById(prev => {
      if (prev[viewportId]) {
        return prev;
      }
      return { ...prev, [viewportId]: true };
    });
    markViewportFirstInstanceSkeletonDoneRef.current(viewportId);
    setViewportInFlightById(prev => ({ ...prev, [viewportId]: false }));
    setViewportIsProgressComputableById(prev => ({ ...prev, [viewportId]: true }));
    setViewportByteProgressById(prev => ({ ...prev, [viewportId]: 1 }));
    setViewportLoadLoadedBytesById(prev => {
      const next = { ...prev };
      delete next[viewportId];
      return next;
    });
    const existingGuard = viewportFirstOverlayGuardTimersRef.current[viewportId];
    if (existingGuard) {
      window.clearTimeout(existingGuard);
      delete viewportFirstOverlayGuardTimersRef.current[viewportId];
    }
  }, []);

  const tryFinalizeFirstViewportOverlayRef = useRef<(viewportId: string) => void>(() => {});
  tryFinalizeFirstViewportOverlayRef.current = tryFinalizeFirstViewportOverlay;

  // SR viewports never fire IMAGE_RENDERED / onFirstImageRendered — finalize loader state when assigned.
  useEffect(() => {
    if (!viewports?.size) {
      return;
    }

    for (const vp of viewports.values()) {
      const viewportId = vp?.viewportOptions?.viewportId;
      if (!viewportId) {
        continue;
      }

      const displaySetInstanceUIDs: string[] = vp?.displaySetInstanceUIDs || [];
      const displaySets = displaySetInstanceUIDs
        .map(uid => displaySetService.getDisplaySetByUID(uid) || {})
        .filter(ds => !ds?.unsupported);

      if (!viewportHasOnlyStructuredReportDisplaySets(displaySets)) {
        continue;
      }

      if (viewportInitialFirstImageCompleteById[viewportId]) {
        continue;
      }

      viewportGridService.setViewportIsReady(viewportId, true);
      viewportFirstPaintedRef.current[viewportId] = true;
      viewportFirstBytesCompleteRef.current[viewportId] = true;
      setHasRenderedAnyViewport(true);
      setViewportFirstImageRenderedById(prev =>
        prev[viewportId] ? prev : { ...prev, [viewportId]: true }
      );
      tryFinalizeFirstViewportOverlay(viewportId);
    }
  }, [
    viewports,
    displaySetService,
    viewportGridService,
    viewportInitialFirstImageCompleteById,
    tryFinalizeFirstViewportOverlay,
  ]);

  const viewportFirstTargets = useMemo(() => {
    const targets: Record<
      string,
      {
        viewportId: string;
        targetImageId: string | null;
        targetUrl: string | null;
        stackImageIds: string[];
        primaryDisplaySetUid: string;
        primarySopInstanceUID: string | null;
        targetUidKey: WadoUidKey | null;
        isIndeterminate: boolean;
        hasDisplaySets: boolean;
      }
    > = {};

    for (const vp of viewports.values()) {
      const viewportId = vp?.viewportOptions?.viewportId;
      if (!viewportId) {
        continue;
      }

      const displaySetInstanceUIDs: string[] = vp?.displaySetInstanceUIDs || [];
      const displaySets = displaySetInstanceUIDs
        .map(uid => displaySetService.getDisplaySetByUID(uid) || {})
        .filter(ds => !ds?.unsupported);

      const hasDisplaySets = displaySets.length > 0;
      const isIndeterminate = isVolumeLikeViewport(vp?.viewportOptions);

      const firstDisplaySet: any = displaySets[0];
      const stackImageIds = collectImageIdsFromDisplaySet(firstDisplaySet);
      const firstImageId = getPrimaryStackImageId(firstDisplaySet);
      const firstUrl = normalizeImageIdToUrl(firstImageId ?? undefined);
      const primarySopInstanceUID =
        (firstUrl ? extractWadoUids(firstUrl)?.objectUID : null) ||
        getPrimarySopUidFromDisplaySet(firstDisplaySet) ||
        null;
      const firstUidKey =
        extractWadoUids(firstUrl) ||
        (primarySopInstanceUID
          ? {
              studyUID: firstDisplaySet?.StudyInstanceUID ?? null,
              seriesUID: firstDisplaySet?.SeriesInstanceUID ?? null,
              objectUID: primarySopInstanceUID,
            }
          : null);
      const primaryDisplaySetUid =
        typeof firstDisplaySet?.displaySetInstanceUID === 'string'
          ? firstDisplaySet.displaySetInstanceUID
          : '';

      targets[viewportId] = {
        viewportId,
        targetImageId: firstImageId,
        targetUrl: firstUrl,
        stackImageIds,
        primaryDisplaySetUid,
        primarySopInstanceUID,
        targetUidKey: firstUidKey,
        isIndeterminate,
        hasDisplaySets,
      };
    }

    return targets;
  }, [viewports, displaySetService]);

  const viewportFirstTargetsRef = useRef(viewportFirstTargets);
  viewportFirstTargetsRef.current = viewportFirstTargets;

  // Key only by viewport + display set — do not include imageId. CornerstoneCacheService assigns
  // imageIds after first paint; including imageId caused a spurious reset that cleared download %.
  const viewportTargetKeyById = useMemo(() => {
    const result: Record<string, string> = {};
    const targets = viewportFirstTargets || {};
    Object.keys(targets).forEach(viewportId => {
      const t = targets[viewportId];
      const dsUid = t?.primaryDisplaySetUid ?? '';
      result[viewportId] = `${viewportId}|${dsUid}`;
    });
    return result;
  }, [viewportFirstTargets]);

  const getViewportPanes = useCallback(() => {
    const viewportPanes = [];

    const numViewportPanes = viewportGridService.getNumViewportPanes();
    for (let i = 0; i < numViewportPanes; i++) {
      const paneMetadata = Array.from(viewports.values())[i] || {};
      const {
        displaySetInstanceUIDs,
        viewportOptions,
        displaySetOptions, // array of options for each display set in the viewport
        x: viewportX,
        y: viewportY,
        width: viewportWidth,
        height: viewportHeight,
        viewportLabel,
      } = paneMetadata;

      const viewportId = viewportOptions.viewportId;
      const isActive = activeViewportId === viewportId;
      const firstTarget = viewportFirstTargets[viewportId];
      const initialComplete = Boolean(viewportInitialFirstImageCompleteById[viewportId]);
      const displaySetInstanceUIDsToUse = displaySetInstanceUIDs || [];
      // This is causing the viewport components re-render when the activeViewportId changes
      const displaySets = displaySetInstanceUIDsToUse
        .map(displaySetInstanceUID => {
          return displaySetService.getDisplaySetByUID(displaySetInstanceUID) || {};
        })
        .filter(displaySet => {
          return !displaySet?.unsupported;
        });

      const isStructuredReportViewport = viewportHasOnlyStructuredReportDisplaySets(displaySets);
      // Show skeleton only before the first successful image render in this study scope.
      // After first render, suppress loader for all later layout switches (including advanced).
      const suppressLoaderAfterInitialRender = Boolean(hasRenderedAnyViewport);
      const firstImageRendered = Boolean(viewportFirstImageRenderedById[viewportId]);
      const hasDisplaySetAssignment = Boolean(displaySetInstanceUIDsToUse.length);
      const showViewportLoader =
        hasDisplaySetAssignment &&
        !isStructuredReportViewport &&
        !suppressLoaderAfterInitialRender &&
        !initialComplete &&
        !firstImageRendered;

      const showInstanceBytesSkeleton =
        hasDisplaySetAssignment &&
        !isStructuredReportViewport &&
        Boolean(viewportInFlightById[viewportId]) &&
        !viewportFirstInstanceDownloadSkeletonDoneById[viewportId];

      const { component: ViewportComponent } = _getViewportComponent(
        displaySets,
        viewportComponents,
        uiNotificationService
      );

      // look inside displaySets to see if they need reRendering
      const displaySetsNeedsRerendering = displaySets.some(displaySet => {
        return displaySet.needsRerendering;
      });

      const onInteractionHandler = event => {
        if (isActive) {
          return;
        }

        if (event && (appConfig?.activateViewportBeforeInteraction ?? true)) {
          event.preventDefault();
          event.stopPropagation();
        }

        viewportGridService.setActiveViewportId(viewportId);
      };

      const getBorderStyle = viewportIndex => {
        const style = {} as any;
        const layoutOptions = viewportGridService.getLayoutOptionsFromState(
          viewportGridService.getState()
        );
        const vp = layoutOptions[viewportIndex];
        if (!vp) {
          return style;
        }
        const { x, y, width, height } = vp;
        const tolerance = 0.01;

        if (x + width < 1 - tolerance) {
          style.borderRight = '1px solid hsl(var(--input))';
        }

        if (y + height < 1 - tolerance) {
          style.borderBottom = '1px solid hsl(var(--input))';
        }

        return style;
      };

      viewportPanes[i] = (
        <ViewportPane
          // Note: It is highly important that the key is the viewportId here,
          // since it is used to determine if the component should be re-rendered
          // by React, and also in the hanging protocol and stage changes if the
          // same viewportId is used, React, by default, will only move (not re-render)
          // those components. For instance, if we have a 2x3 layout, and we move
          // from 2x3 to 1x1 (second viewport), if the key is the viewportIndex,
          // React will RE-RENDER the resulting viewport as the key will be different.
          // however, if the key is the viewportId, React will only move the component
          // and not re-render it.
          key={viewportId}
          acceptDropsFor="displayset"
          onDrop={onDropHandler.bind(null, viewportId)}
          onInteraction={onInteractionHandler}
          customStyle={{
            position: 'absolute',
            top: viewportY * 100 + '%',
            left: viewportX * 100 + '%',
            width: viewportWidth * 100 + '%',
            height: viewportHeight * 100 + '%',
            ...getBorderStyle(i),
          }}
          isActive={isActive}
        >
          <div
            data-cy="viewport-pane"
            data-is-active={isActive}
            className="relative flex h-full w-full min-w-[5px] flex-col"
          >
            <ViewportComponent
              displaySets={displaySets}
              viewportLabel={viewports.size > 1 ? viewportLabel : ''}
              viewportId={viewportId}
              dataSource={dataSource}
              viewportOptions={viewportOptions}
              displaySetOptions={displaySetOptions}
              needsRerendering={displaySetsNeedsRerendering}
              isHangingProtocolLayout={isHangingProtocolLayout}
              onElementEnabled={evt => {
                viewportGridService.setViewportIsReady(viewportId, true);
              }}
              onFirstImageRendered={() => {
                viewportFirstPaintedRef.current[viewportId] = true;
                setHasRenderedAnyViewport(true);
                setViewportFirstImageRenderedById(prev => ({ ...prev, [viewportId]: true }));
                tryFinalizeFirstViewportOverlay(viewportId);
              }}
            />
            {showViewportLoader && (
              <div
                className="absolute inset-0 z-[100] flex flex-col items-center justify-center bg-black/70"
                aria-busy="true"
                aria-label="Loading images"
              >
                <div className="w-[280px] space-y-3">
                  <div className="space-y-2">
                    <div className="mx-auto h-3 w-40 animate-pulse rounded bg-primary-light/30" />
                    <div className="mx-auto h-2 w-56 animate-pulse rounded bg-primary-light/20" />
                  </div>
                  <p className="text-primary-light/90 text-center text-sm font-medium">
                    Preparing first image...
                  </p>
                </div>
              </div>
            )}
            {showInstanceBytesSkeleton && (
              <div
                className="pointer-events-none absolute inset-0 z-[99] flex flex-col items-center justify-center bg-black/50"
                aria-busy="true"
                aria-label="Downloading DICOM instance"
              >
                <div className="w-[280px] space-y-3 px-4">
                  <div className="mx-auto aspect-[4/3] w-full max-w-[240px] animate-pulse rounded-lg bg-primary-light/20" />
                  <div className="space-y-2">
                    <div className="mx-auto h-2.5 w-32 animate-pulse rounded bg-primary-light/30" />
                    <div className="mx-auto h-2 w-44 animate-pulse rounded bg-primary-light/20" />
                  </div>
                  <p className="text-primary-light/90 text-center text-sm font-medium">
                    Downloading image…
                  </p>
                </div>
              </div>
            )}
          </div>
        </ViewportPane>
      );
    }

    return viewportPanes;
  }, [
    viewports,
    activeViewportId,
    viewportComponents,
    dataSource,
    hasRenderedAnyViewport,
    viewportFirstTargets,
    viewportFirstImageRenderedById,
    viewportInitialFirstImageCompleteById,
    viewportInFlightById,
    viewportFirstInstanceDownloadSkeletonDoneById,
    tryFinalizeFirstViewportOverlay,
  ]);

  // Reset per-viewport loader state when a viewport is reassigned to a different first image.
  const prevViewportTargetKeyByIdRef = useRef(viewportTargetKeyById);
  useEffect(() => {
    const prevKeys = prevViewportTargetKeyByIdRef.current || {};
    const nextKeys = viewportTargetKeyById || {};
    prevViewportTargetKeyByIdRef.current = nextKeys;

    const allViewportIds = new Set([...Object.keys(prevKeys), ...Object.keys(nextKeys)]);
    const viewportIdsToReset: string[] = [];
    const viewportIdsToRemove: string[] = [];

    for (const viewportId of allViewportIds) {
      const prevKey = prevKeys[viewportId];
      const nextKey = nextKeys[viewportId];

      if (!nextKey) {
        viewportIdsToRemove.push(viewportId);
        continue;
      }

      if (prevKey !== nextKey) {
        viewportIdsToReset.push(viewportId);
      }
    }

    if (!viewportIdsToReset.length && !viewportIdsToRemove.length) {
      return;
    }

    const clearFirstLoadRefs = (id: string) => {
      delete viewportFirstPaintedRef.current[id];
      delete viewportFirstBytesCompleteRef.current[id];
      delete viewportFirstEverInFlightRef.current[id];
      delete viewportFirstInstanceSkeletonLatchRef.current[id];
    };
    viewportIdsToRemove.forEach(clearFirstLoadRefs);
    viewportIdsToReset.forEach(clearFirstLoadRefs);

    // IMPORTANT: do not "delete" keys for resets; explicitly set them back to false/null.
    // This avoids races where a fast render sets the flag true, then a reset deletes it.
    setViewportFirstImageRenderedById(prev => {
      const next = { ...prev };
      viewportIdsToRemove.forEach(id => delete next[id]);
      viewportIdsToReset.forEach(id => {
        next[id] = false;
      });
      return next;
    });
    setViewportFirstImageDownloadedById(prev => {
      const next = { ...prev };
      viewportIdsToRemove.forEach(id => delete next[id]);
      viewportIdsToReset.forEach(id => {
        next[id] = false;
      });
      return next;
    });
    setViewportInitialFirstImageCompleteById(prev => {
      const next = { ...prev };
      viewportIdsToRemove.forEach(id => delete next[id]);
      viewportIdsToReset.forEach(id => {
        next[id] = false;
      });
      return next;
    });
    setViewportByteProgressById(prev => {
      const next = { ...prev };
      viewportIdsToRemove.forEach(id => delete next[id]);
      viewportIdsToReset.forEach(id => {
        next[id] = null;
      });
      return next;
    });
    setViewportIsProgressComputableById(prev => {
      const next = { ...prev };
      viewportIdsToRemove.forEach(id => delete next[id]);
      viewportIdsToReset.forEach(id => {
        next[id] = false;
      });
      return next;
    });
    setViewportInFlightById(prev => {
      const next = { ...prev };
      viewportIdsToRemove.forEach(id => delete next[id]);
      viewportIdsToReset.forEach(id => {
        next[id] = false;
      });
      return next;
    });
    setViewportLoadLoadedBytesById(prev => {
      const next = { ...prev };
      viewportIdsToRemove.forEach(id => delete next[id]);
      viewportIdsToReset.forEach(id => delete next[id]);
      return next;
    });
    setViewportBlobPhaseStartedById(prev => {
      const next = { ...prev };
      viewportIdsToRemove.forEach(id => delete next[id]);
      viewportIdsToReset.forEach(id => {
        next[id] = false;
      });
      return next;
    });
    setViewportFirstInstanceDownloadSkeletonDoneById(prev => {
      const next = { ...prev };
      viewportIdsToRemove.forEach(id => delete next[id]);
      viewportIdsToReset.forEach(id => {
        next[id] = false;
      });
      return next;
    });
  }, [viewportTargetKeyById]);

  // Guard against missing/late network progress events during layout switches.
  // If first render occurred but byte-complete never arrives, force-finalize after a short delay.
  useEffect(() => {
    const activeViewportIds = Object.keys(viewportFirstTargets || {});
    const guards = viewportFirstOverlayGuardTimersRef.current;

    activeViewportIds.forEach(viewportId => {
      const alreadyComplete = Boolean(viewportInitialFirstImageCompleteById[viewportId]);
      const painted = Boolean(viewportFirstImageRenderedById[viewportId]);
      const bytesDone = Boolean(viewportFirstImageDownloadedById[viewportId]);
      const hasGuard = Boolean(guards[viewportId]);

      if (alreadyComplete || !painted || bytesDone) {
        if (hasGuard) {
          window.clearTimeout(guards[viewportId]);
          delete guards[viewportId];
        }
        return;
      }

      if (!hasGuard) {
        guards[viewportId] = window.setTimeout(() => {
          tryFinalizeFirstViewportOverlayRef.current(viewportId);
        }, 6000);
      }
    });

    Object.keys(guards).forEach(viewportId => {
      if (!activeViewportIds.includes(viewportId)) {
        window.clearTimeout(guards[viewportId]);
        delete guards[viewportId];
      }
    });

  }, [
    viewportFirstTargets,
    viewportFirstImageRenderedById,
    viewportFirstImageDownloadedById,
    viewportInitialFirstImageCompleteById,
  ]);

  useEffect(() => {
    return () => {
      const guards = viewportFirstOverlayGuardTimersRef.current;
      Object.values(guards).forEach(timerId => window.clearTimeout(timerId));
      Object.keys(guards).forEach(key => delete guards[key]);
    };
  }, []);

  // First paint (IMAGE_RENDERED) can arrive before the WADO→blob XHR completes; the overlay is
  // dismissed only when tryFinalizeFirstViewportOverlay sees both paint + bytes (see refs above).
  useEffect(() => {
    let debounceTimer: number | undefined;
    let maxDurationTimer: number | undefined;

    if (!hasRenderedAnyViewport && hasPendingHPViewports) {
      debounceTimer = window.setTimeout(() => {
        setLayoutLoading(true);
        // Force-hide overlay after 4s so it never stays stuck (e.g. MPR → single, or ready event missed).
        maxDurationTimer = window.setTimeout(() => {
          setLayoutLoading(false);
        }, 4000);
      }, 150);
    } else {
      setLayoutLoading(false);
    }

    return () => {
      if (debounceTimer) window.clearTimeout(debounceTimer);
      if (maxDurationTimer) window.clearTimeout(maxDurationTimer);
    };
  }, [hasPendingHPViewports, hasRenderedAnyViewport]);

  useEffect(() => {
    const handleWadoRequestProgress = evt => {
      const requestId = evt?.detail?.requestId;
      const progress = evt?.detail?.progress;
      const done = Boolean(evt?.detail?.done);
      const lengthComputable = Boolean(evt?.detail?.lengthComputable);
      const requestUrl = evt?.detail?.requestUrl;
      if (!requestId) {
        return;
      }

      if (!requestUrl || typeof requestUrl !== 'string') {
        return;
      }

      // Scope progress to the matching viewport's first-image identity.
      // 1) WADO-RS / query-param URLs: match by objectUID (and study/series when available).
      // 2) Blob / custom stores (Azure, etc.): match by origin+pathname (ignore SAS query).
      const requestKey = extractWadoUids(requestUrl);
      const requestPathKey = normalizeUrlPathForProgressMatch(requestUrl);

      const targets = viewportFirstTargetsRef.current || {};

      let matchingViewportIds = Object.keys(targets).filter(viewportId =>
        requestKey ? doesUidMatch(targets[viewportId]?.targetUidKey ?? null, requestKey) : false
      );

      if (!matchingViewportIds.length && requestPathKey) {
        matchingViewportIds = Object.keys(targets).filter(viewportId => {
          const targetUrl = targets[viewportId]?.targetUrl;
          const targetPathKey = normalizeUrlPathForProgressMatch(targetUrl);
          return Boolean(targetPathKey && targetPathKey === requestPathKey);
        });
      }

      if (!matchingViewportIds.length) {
        const reqPn = normalizeDicomRequestPathname(requestUrl);
        if (reqPn) {
          matchingViewportIds = Object.keys(targets).filter(viewportId => {
            const targetUrl = targets[viewportId]?.targetUrl;
            const tp = normalizeDicomRequestPathname(targetUrl);
            return Boolean(tp && tp === reqPn);
          });
        }
      }

      if (!matchingViewportIds.length) {
        matchingViewportIds = findViewportsByDicomLoaderUrl(
          requestUrl,
          undefined,
          viewportsProgressRef.current
        );
      }

      if (!matchingViewportIds.length) {
        matchingViewportIds = findViewportsByPrimarySopInRequestUrl(requestUrl, targets);
      }

      const responseURLForMatch =
        typeof evt?.detail?.responseURL === 'string' ? evt.detail.responseURL : '';
      if (!matchingViewportIds.length && responseURLForMatch) {
        matchingViewportIds = findViewportsByPrimarySopInRequestUrl(responseURLForMatch, targets);
      }

      if (!matchingViewportIds.length) {
        const activeId = activeViewportIdRef.current;
        const t = activeId ? targets[activeId] : undefined;
        const urlForHeuristic = responseURLForMatch || requestUrl;
        if (
          activeId &&
          t?.hasDisplaySets &&
          !t?.isIndeterminate &&
          isLikelyDicomInstanceByteGetUrl(urlForHeuristic)
        ) {
          matchingViewportIds = [activeId];
        }
      }

      if (!matchingViewportIds.length) {
        return;
      }

      const loaderUiViewportIds = narrowMatchingViewportsForLoaderUi(
        matchingViewportIds,
        targets,
        activeViewportIdRef.current
      );

      const xhrLoaded = typeof evt?.detail?.loaded === 'number' && !Number.isNaN(evt.detail.loaded) ? evt.detail.loaded : null;
      const responseURLGate =
        typeof evt?.detail?.responseURL === 'string' ? evt.detail.responseURL : '';

      const sameUrlDirectBytes =
        xhrLoaded != null &&
        xhrLoaded > 0 &&
        responseURLGate &&
        requestUrl &&
        responseURLGate === requestUrl;

      // Align with initWADOImageLoader: no loader for API/wadouri hop alone (wait for blob responseURL, large body, or same-URL stream).
      if (
        !done &&
        !isWadoRsDirectFramePixelUrl(requestUrl) &&
        isMultiHopDicomProgressRequestUrl(requestUrl) &&
        !isLikelyFinalDicomBytesUrl(responseURLGate) &&
        !(xhrLoaded != null && xhrLoaded > 65536) &&
        !sameUrlDirectBytes
      ) {
        return;
      }

      // Do not treat loadend as finished instance bytes if we never left the wadouri gateway URL.
      if (done && isWadoGatewayUrl(requestUrl) && !isLikelyFinalDicomBytesUrl(responseURLGate)) {
        return;
      }

      setViewportBlobPhaseStartedById(prev => {
        let changed = false;
        const next = { ...prev };
        for (const id of matchingViewportIds) {
          if (!next[id]) {
            next[id] = true;
            changed = true;
          }
        }
        return changed ? next : prev;
      });

      for (const viewportId of matchingViewportIds) {
        if (done) {
          viewportFirstBytesCompleteRef.current[viewportId] = true;
          setViewportFirstImageDownloadedById(prev => ({ ...prev, [viewportId]: true }));
          if (isLikelyPrimaryInstanceBytesDelivery(requestUrl, responseURLGate || undefined, viewportId, targets)) {
            markViewportFirstInstanceSkeletonDoneRef.current(viewportId);
          }
          if (
            loaderUiViewportIds.includes(viewportId) &&
            isLikelyPrimaryInstanceBytesDelivery(requestUrl, responseURLGate || undefined, viewportId, targets)
          ) {
            setViewportInFlightById(prev => ({ ...prev, [viewportId]: false }));
          }
          setViewportIsProgressComputableById(prev => ({ ...prev, [viewportId]: true }));
          setViewportByteProgressById(prev => mergeMonotonicViewportByteProgress(prev, viewportId, 1));
          tryFinalizeFirstViewportOverlayRef.current(viewportId);
          continue;
        }

        if (isLikelyPrimaryInstanceBytesDelivery(requestUrl, responseURLGate || undefined, viewportId, targets)) {
          viewportFirstEverInFlightRef.current[viewportId] = true;
          if (
            loaderUiViewportIds.includes(viewportId) &&
            !viewportFirstInstanceSkeletonLatchRef.current[viewportId]
          ) {
            setViewportInFlightById(prev => ({ ...prev, [viewportId]: true }));
          }
        }
        setViewportIsProgressComputableById(prev => ({
          ...prev,
          [viewportId]: Boolean(lengthComputable || prev[viewportId]),
        }));
        if (xhrLoaded != null && xhrLoaded > 0) {
          setViewportLoadLoadedBytesById(prev => ({ ...prev, [viewportId]: xhrLoaded }));
        }
        if (typeof progress === 'number' && !Number.isNaN(progress)) {
          const clamped = Math.max(0, Math.min(1, progress));
          const responseURL =
            typeof evt?.detail?.responseURL === 'string' ? evt.detail.responseURL : '';
          // Do not treat the tiny 302 hop as a finished download (was leaving a black viewport during blob XHR).
          if (
            !done &&
            clamped >= 1 &&
            isMultiHopDicomProgressRequestUrl(requestUrl) &&
            !isLikelyFinalDicomBytesUrl(responseURL)
          ) {
            continue;
          }
          setViewportByteProgressById(prev => mergeMonotonicViewportByteProgress(prev, viewportId, clamped));
          if (clamped >= 1) {
            viewportFirstBytesCompleteRef.current[viewportId] = true;
            setViewportFirstImageDownloadedById(prev => ({ ...prev, [viewportId]: true }));
            if (isLikelyPrimaryInstanceBytesDelivery(requestUrl, responseURL || undefined, viewportId, targets)) {
              markViewportFirstInstanceSkeletonDoneRef.current(viewportId);
            }
            if (
              loaderUiViewportIds.includes(viewportId) &&
              isLikelyPrimaryInstanceBytesDelivery(requestUrl, responseURL || undefined, viewportId, targets)
            ) {
              setViewportInFlightById(prev => ({ ...prev, [viewportId]: false }));
            }
            tryFinalizeFirstViewportOverlayRef.current(viewportId);
          }
        }
      }
    };

    window.addEventListener('ohif:wado-image-request-progress', handleWadoRequestProgress);
    return () => {
      window.removeEventListener('ohif:wado-image-request-progress', handleWadoRequestProgress);
    };
  }, []);

  /**
   * Primary path: dicom-image-loader.init({ onloadstart, onprogress, onloadend }) — same module as XHR,
   * so imageId always matches the stack (avoids duplicate @cornerstonejs/core eventTarget issues).
   */
  useEffect(() => {
    const handleDicomLoaderXhr = evt => {
      const d = evt?.detail;
      const phase = d?.phase;
      const imageId = d?.imageId;
      if (!phase || typeof imageId !== 'string') {
        return;
      }

      const targets = viewportFirstTargetsRef.current || {};
      let matchingViewportIds = findMatchingViewportIdsForImageId(imageId, targets);
      if (!matchingViewportIds.length) {
        matchingViewportIds = findViewportsByDicomLoaderUrl(
          d?.url,
          imageId,
          viewportsProgressRef.current
        );
      }
      if (!matchingViewportIds.length) {
        const urlForUid = d?.url || normalizeImageIdToUrl(imageId) || imageId;
        matchingViewportIds = findViewportsByPrimarySopInRequestUrl(urlForUid, targets);
      }
      if (!matchingViewportIds.length) {
        const activeId = activeViewportIdRef.current;
        const t = activeId ? targets[activeId] : undefined;
        const urlForHeuristic = d?.url || normalizeImageIdToUrl(imageId) || imageId;
        const urlStr = typeof urlForHeuristic === 'string' ? urlForHeuristic : '';
        const fromDicomLoader =
          /^dicomweb|^dicomweb-jpeg|^wadouri|^wadors/i.test(imageId) ||
          isLikelyDicomInstanceByteGetUrl(urlStr);
        if (activeId && t?.hasDisplaySets && !t?.isIndeterminate && fromDicomLoader) {
          matchingViewportIds = [activeId];
        }
      }
      if (!matchingViewportIds.length) {
        return;
      }

      const loaderUiViewportIds = narrowMatchingViewportsForLoaderUi(
        matchingViewportIds,
        targets,
        activeViewportIdRef.current
      );

      if (phase === 'start') {
        const openUrlForStart = d?.url || normalizeImageIdToUrl(imageId) || imageId;
        const openStr = typeof openUrlForStart === 'string' ? openUrlForStart : '';
        if (!isWadoRsDirectFramePixelUrl(openStr) && isMultiHopDicomProgressRequestUrl(openStr)) {
          return;
        }
        setViewportBlobPhaseStartedById(prev => {
          let changed = false;
          const next = { ...prev };
          for (const id of matchingViewportIds) {
            if (!next[id]) {
              next[id] = true;
              changed = true;
            }
          }
          return changed ? next : prev;
        });
        setViewportLoadLoadedBytesById(prev => {
          const next = { ...prev };
          matchingViewportIds.forEach(id => delete next[id]);
          return next;
        });
        for (const viewportId of matchingViewportIds) {
          if (!isViewportPrimaryStackImageId(imageId, viewportId, targets)) {
            continue;
          }
          viewportFirstEverInFlightRef.current[viewportId] = true;
          if (
            loaderUiViewportIds.includes(viewportId) &&
            !viewportFirstInstanceSkeletonLatchRef.current[viewportId]
          ) {
            setViewportInFlightById(prev => ({ ...prev, [viewportId]: true }));
          }
        }
        return;
      }

      if (phase === 'progress') {
        const loaded = typeof d.loaded === 'number' && !Number.isNaN(d.loaded) ? d.loaded : 0;
        const total = typeof d.total === 'number' && !Number.isNaN(d.total) ? d.total : 0;
        const lengthComputable = Boolean(d.lengthComputable) && total > 0;
        const loaderUrlForTrivial = d?.url || normalizeImageIdToUrl(imageId) || imageId;
        const trivialGatewayHop =
          lengthComputable &&
          total > 0 &&
          total < 65536 &&
          !isWadoRsDirectFramePixelUrl(loaderUrlForTrivial) &&
          isMultiHopDicomProgressRequestUrl(loaderUrlForTrivial);
        if (trivialGatewayHop) {
          return;
        }
        setViewportBlobPhaseStartedById(prev => {
          let changed = false;
          const next = { ...prev };
          for (const id of matchingViewportIds) {
            if (!next[id]) {
              next[id] = true;
              changed = true;
            }
          }
          return changed ? next : prev;
        });
        const progress = lengthComputable ? Math.min(1, loaded / total) : undefined;

        for (const viewportId of matchingViewportIds) {
          if (loaded > 0) {
            setViewportLoadLoadedBytesById(prev => ({ ...prev, [viewportId]: loaded }));
          }
          if (isViewportPrimaryStackImageId(imageId, viewportId, targets)) {
            viewportFirstEverInFlightRef.current[viewportId] = true;
            if (
              loaderUiViewportIds.includes(viewportId) &&
              !viewportFirstInstanceSkeletonLatchRef.current[viewportId]
            ) {
              setViewportInFlightById(prev => ({ ...prev, [viewportId]: true }));
            }
          }
          setViewportIsProgressComputableById(prev => ({
            ...prev,
            [viewportId]: Boolean(lengthComputable || prev[viewportId]),
          }));
          if (typeof progress === 'number' && !Number.isNaN(progress)) {
            setViewportByteProgressById(prev =>
              mergeMonotonicViewportByteProgress(prev, viewportId, progress)
            );
            if (progress >= 1) {
              viewportFirstBytesCompleteRef.current[viewportId] = true;
              setViewportFirstImageDownloadedById(prev => ({ ...prev, [viewportId]: true }));
              if (isViewportPrimaryStackImageId(imageId, viewportId, targets)) {
                markViewportFirstInstanceSkeletonDoneRef.current(viewportId);
              }
              if (
                loaderUiViewportIds.includes(viewportId) &&
                isViewportPrimaryStackImageId(imageId, viewportId, targets)
              ) {
                setViewportInFlightById(prev => ({ ...prev, [viewportId]: false }));
              }
              tryFinalizeFirstViewportOverlayRef.current(viewportId);
            }
          }
        }
        return;
      }

      if (phase === 'end') {
        setViewportBlobPhaseStartedById(prev => {
          let changed = false;
          const next = { ...prev };
          for (const id of matchingViewportIds) {
            if (!next[id]) {
              next[id] = true;
              changed = true;
            }
          }
          return changed ? next : prev;
        });
        for (const viewportId of matchingViewportIds) {
          viewportFirstBytesCompleteRef.current[viewportId] = true;
          setViewportFirstImageDownloadedById(prev => ({ ...prev, [viewportId]: true }));
          if (isViewportPrimaryStackImageId(imageId, viewportId, targets)) {
            markViewportFirstInstanceSkeletonDoneRef.current(viewportId);
          }
          if (
            loaderUiViewportIds.includes(viewportId) &&
            isViewportPrimaryStackImageId(imageId, viewportId, targets)
          ) {
            setViewportInFlightById(prev => ({ ...prev, [viewportId]: false }));
          }
          setViewportIsProgressComputableById(prev => ({ ...prev, [viewportId]: true }));
          setViewportByteProgressById(prev => mergeMonotonicViewportByteProgress(prev, viewportId, 1));
          tryFinalizeFirstViewportOverlayRef.current(viewportId);
        }
      }
    };

    window.addEventListener('ohif:dicom-loader-xhr', handleDicomLoaderXhr);
    return () => {
      window.removeEventListener('ohif:dicom-loader-xhr', handleDicomLoaderXhr);
    };
  }, []);

  useEffect(() => {
    const handleJpegImageProgress = evt => {
      const imageId = evt?.detail?.imageId;
      const progress = evt?.detail?.progress;
      const lengthComputable = evt?.detail?.lengthComputable;
      if (!imageId || typeof progress !== 'number' || Number.isNaN(progress)) {
        return;
      }

      const clamped = Math.max(0, Math.min(1, progress));

      const targets = viewportFirstTargetsRef.current || {};
      const matchingViewportIds = findMatchingViewportIdsForImageId(imageId, targets);
      if (!matchingViewportIds.length) {
        return;
      }

      const loaderUiViewportIds = narrowMatchingViewportsForLoaderUi(
        matchingViewportIds,
        targets,
        activeViewportIdRef.current
      );

      for (const viewportId of matchingViewportIds) {
        const primary = isViewportPrimaryStackImageId(imageId, viewportId, targets);
        if (clamped >= 1) {
          viewportFirstBytesCompleteRef.current[viewportId] = true;
          setViewportFirstImageDownloadedById(prev => ({ ...prev, [viewportId]: true }));
          if (primary) {
            markViewportFirstInstanceSkeletonDoneRef.current(viewportId);
          }
          if (primary && loaderUiViewportIds.includes(viewportId)) {
            setViewportInFlightById(prev => ({ ...prev, [viewportId]: false }));
          }
          tryFinalizeFirstViewportOverlayRef.current(viewportId);
        } else if (primary) {
          viewportFirstEverInFlightRef.current[viewportId] = true;
          if (
            loaderUiViewportIds.includes(viewportId) &&
            !viewportFirstInstanceSkeletonLatchRef.current[viewportId]
          ) {
            setViewportInFlightById(prev => ({ ...prev, [viewportId]: true }));
          }
        }

        setViewportByteProgressById(prev => mergeMonotonicViewportByteProgress(prev, viewportId, clamped));
        setViewportIsProgressComputableById(prev => ({
          ...prev,
          [viewportId]: Boolean(lengthComputable || prev[viewportId]),
        }));
      }
    };

    window.addEventListener('ohif:jpeg-image-progress', handleJpegImageProgress);
    return () => {
      window.removeEventListener('ohif:jpeg-image-progress', handleJpegImageProgress);
    };
  }, []);

  useEffect(() => {
    if (!studyPrefetcherService?.subscribe) {
      return;
    }
    const subProgress = studyPrefetcherService.subscribe(
      studyPrefetcherService.EVENTS.DISPLAYSET_LOAD_PROGRESS,
      ({ displaySetInstanceUID, numInstances, loadingProgress }) => {
        setViewportLoadingState(prev => ({
          ...prev,
          [displaySetInstanceUID]: { loadingProgress, numInstances },
        }));
      }
    );
    const subComplete = studyPrefetcherService.subscribe(
      studyPrefetcherService.EVENTS.DISPLAYSET_LOAD_COMPLETE,
      ({ displaySetInstanceUID }) => {
        setViewportLoadingState(prev => ({
          ...prev,
          [displaySetInstanceUID]: { ...(prev[displaySetInstanceUID] || {}), loadingProgress: 1 },
        }));
      }
    );

    return () => {
      subProgress?.unsubscribe?.();
      subComplete?.unsubscribe?.();
    };
  }, [studyPrefetcherService]);

  /**
   * Loading indicator until numCols and numRows are gotten from the HangingProtocolService
   */
  if (!numRows || !numCols) {
    return null;
  }

  return (
    <div className="border-input relative h-[calc(100%-0.25rem)] w-full border">
      <ViewportGrid
        numRows={numRows}
        numCols={numCols}
      >
        {getViewportPanes()}
      </ViewportGrid>
      {layoutLoading && (
        <div
          className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-black/70"
          aria-busy="true"
          aria-label="Loading layout"
        >
          <>
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary-light border-t-transparent" />
            <p className="text-primary-light mt-3 text-sm font-medium">Preparing view...</p>
            <p className="text-primary-light/80 mt-1 text-xs">Loading data for this layout</p>
          </>
        </div>
      )}
    </div>
  );
}

function _getViewportComponent(displaySets, viewportComponents, uiNotificationService) {
  if (!displaySets || !displaySets.length) {
    return { component: EmptyViewport, isReferenceViewable: () => false };
  }

  // Todo: Do we have a viewport that has two different SOPClassHandlerIds?
  const SOPClassHandlerId = displaySets[0].SOPClassHandlerId;

  for (let i = 0; i < viewportComponents.length; i++) {
    if (!viewportComponents[i]) {
      throw new Error('viewport components not defined');
    }
    if (!viewportComponents[i].displaySetsToDisplay) {
      throw new Error('displaySetsToDisplay is null');
    }
    if (viewportComponents[i].displaySetsToDisplay.includes(SOPClassHandlerId)) {
      const { component } = viewportComponents[i];
      return { component };
    }
  }

  console.log("Can't show displaySet", SOPClassHandlerId, displaySets[0]);
  uiNotificationService.show({
    title: 'Viewport Not Supported Yet',
    message: `Cannot display SOPClassUID of ${displaySets[0].SOPClassUID} yet`,
    type: 'error',
  });

  return { component: EmptyViewport };
}

export default ViewerViewportGrid;
