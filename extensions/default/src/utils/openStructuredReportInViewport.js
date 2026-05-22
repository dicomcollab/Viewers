import {
  SOPClassHandlerId,
  SOPClassHandlerId3D,
} from '@ohif/extension-cornerstone-dicom-sr/src/id.js';

const SR_HANDLER_IDS = [SOPClassHandlerId, SOPClassHandlerId3D];

/** DICOM SR document storage SOP classes (subset used for dose / CAD reports). */
export const STRUCTURED_REPORT_SOP_CLASS_UIDS = [
  '1.2.840.10008.5.1.4.1.1.88.11',
  '1.2.840.10008.5.1.4.1.1.88.22',
  '1.2.840.10008.5.1.4.1.1.88.33',
  '1.2.840.10008.5.1.4.1.1.88.34',
  '1.2.840.10008.5.1.4.1.1.88.40',
  '1.2.840.10008.5.1.4.1.1.88.50',
  '1.2.840.10008.5.1.4.1.1.88.59',
  '1.2.840.10008.5.1.4.1.1.88.65',
  '1.2.840.10008.5.1.4.1.1.88.67',
  '1.2.840.10008.5.1.4.1.1.88.68',
  '1.2.840.10008.5.1.4.1.1.88.69',
  '1.2.840.10008.5.1.4.1.1.88.70',
];

export function isStructuredReportSopClassUID(sopClassUID) {
  return (
    typeof sopClassUID === 'string' &&
    STRUCTURED_REPORT_SOP_CLASS_UIDS.includes(sopClassUID)
  );
}

export function isStructuredReportDisplaySet(displaySet) {
  if (!displaySet) {
    return false;
  }
  return (
    displaySet.Modality === 'SR' ||
    isStructuredReportSopClassUID(displaySet.SOPClassUID) ||
    (displaySet.SOPClassHandlerId && SR_HANDLER_IDS.includes(displaySet.SOPClassHandlerId))
  );
}

/**
 * Pick a viewport that can show SR (prefer one already showing SR).
 */
export function resolveViewportIdForStructuredReport(
  displaySet,
  { activeViewportId, viewportGridService, displaySetService }
) {
  if (!isStructuredReportDisplaySet(displaySet)) {
    return activeViewportId;
  }

  const { viewports } = viewportGridService.getState();

  for (const vp of viewports.values()) {
    const uids = vp.displaySetInstanceUIDs || [];
    for (const uid of uids) {
      const ds = displaySetService.getDisplaySetByUID(uid);
      if (ds && SR_HANDLER_IDS.includes(ds.SOPClassHandlerId)) {
        return vp.viewportOptions.viewportId;
      }
    }
  }

  for (const vp of viewports.values()) {
    if (vp.displaySetInstanceUIDs?.includes(displaySet.displaySetInstanceUID)) {
      return vp.viewportOptions.viewportId;
    }
  }

  return activeViewportId;
}

/**
 * HP-driven viewport updates with a direct fallback so SR always opens.
 */
export function buildViewportsUpdateForDisplaySet(
  displaySetInstanceUID,
  viewportId,
  hangingProtocolService,
  isHangingProtocolLayout
) {
  try {
    const updated = hangingProtocolService.getViewportsRequireUpdate(
      viewportId,
      displaySetInstanceUID,
      isHangingProtocolLayout
    );
    if (updated?.length) {
      return updated;
    }
  } catch (error) {
    console.warn('[SR] getViewportsRequireUpdate failed, using direct assignment', error);
  }

  return [
    {
      viewportId,
      displaySetInstanceUIDs: [displaySetInstanceUID],
    },
  ];
}
