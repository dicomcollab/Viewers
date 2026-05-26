import { metaData, Enums } from '@cornerstonejs/core';

function getPetFrameReferenceTime(props) {
  const { instance, referenceInstance, imageSliceData, viewportData } = props;
  let frameReferenceTime =
    instance?.FrameReferenceTime ?? referenceInstance?.FrameReferenceTime;

  if (frameReferenceTime == null && viewportData?.viewportType === Enums.ViewportType.STACK) {
    const imageIds = viewportData.data?.[0]?.imageIds;
    const imageIndex = imageSliceData?.imageIndex ?? 0;
    const imageId = imageIds?.[imageIndex];
    if (imageId) {
      const petImageModule = metaData.get('petImageModule', imageId) || {};
      frameReferenceTime = petImageModule.frameReferenceTime;
    }
  }

  if (frameReferenceTime == null || frameReferenceTime === '') {
    return null;
  }

  const numeric = Number(frameReferenceTime);
  if (Number.isFinite(numeric)) {
    return `${numeric} ms`;
  }

  return String(frameReferenceTime);
}

function isPtWithFrameReferenceTime(props) {
  const modality = props.displaySet?.Modality ?? props.referenceInstance?.Modality;
  if (modality !== 'PT') {
    return false;
  }
  return getPetFrameReferenceTime(props) != null;
}

export default {
  'viewportOverlay.topLeft': [
    {
      id: 'StudyDate',
      inheritsFrom: 'ohif.overlayItem',
      label: '',
      title: 'Study date',
      condition: ({ referenceInstance }) => referenceInstance?.StudyDate,
      contentF: ({ referenceInstance, formatters: { formatDate } }) =>
        formatDate(referenceInstance.StudyDate),
    },
    {
      id: 'SeriesDescription',
      inheritsFrom: 'ohif.overlayItem',
      label: '',
      title: 'Series description',
      condition: ({ referenceInstance }) => {
        return referenceInstance && referenceInstance.SeriesDescription;
      },
      contentF: ({ referenceInstance }) => referenceInstance.SeriesDescription,
    },
  ],
  'viewportOverlay.topRight': [],
  'viewportOverlay.bottomLeft': [
    {
      id: 'WindowLevel',
      inheritsFrom: 'ohif.overlayItem.windowLevel',
      title: 'Window Level',
    },
    {
      id: 'petFrameReferenceTime',
      inheritsFrom: 'ohif.overlayItem',
      label: 'FRT:',
      title: 'PET Frame Reference Time',
      condition: isPtWithFrameReferenceTime,
      contentF: getPetFrameReferenceTime,
    },
    {
      id: 'ZoomLevel',
      inheritsFrom: 'ohif.overlayItem.zoomLevel',
      condition: props => {
        const activeToolName = props.toolGroupService.getActiveToolForViewport(props.viewportId);
        return activeToolName === 'Zoom';
      },
    },
  ],
  'viewportOverlay.bottomRight': [
    {
      id: 'InstanceNumber',
      inheritsFrom: 'ohif.overlayItem.instanceNumber',
      title: 'Instance Number',
    },
  ],
};
