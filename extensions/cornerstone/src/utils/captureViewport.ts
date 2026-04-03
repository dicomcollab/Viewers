import html2canvas from 'html2canvas';
import { getEnabledElement, StackViewport, BaseVolumeViewport } from '@cornerstonejs/core';
import { ToolGroupManager, segmentation, Enums } from '@cornerstonejs/tools';
import { getEnabledElement as OHIFgetEnabledElement } from '../state';

const DEFAULT_SIZE = 512;
const MAX_TEXTURE_SIZE = 10000;

type CaptureViewportOptions = {
  activeViewportId: string;
  cornerstoneViewportService: any;
  showAnnotations?: boolean;
  width?: number;
  height?: number;
  fileType?: 'png' | 'jpg' | 'jpeg';
  quality?: number;
};

export type CaptureViewportResult = {
  dataUrl: string;
  blob: Blob | null;
  width: number;
  height: number;
  mimeType: string;
};

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export async function captureViewportImage({
  activeViewportId,
  cornerstoneViewportService,
  showAnnotations = true,
  width = DEFAULT_SIZE,
  height = DEFAULT_SIZE,
  fileType = 'png',
  quality = 1,
}: CaptureViewportOptions): Promise<CaptureViewportResult> {
  const refViewportEnabledElementOHIF = OHIFgetEnabledElement(activeViewportId);
  const activeViewportElement = refViewportEnabledElementOHIF?.element;

  if (!activeViewportElement) {
    throw new Error('No active viewport element found');
  }

  const activeViewportEnabledElement = getEnabledElement(activeViewportElement);
  if (!activeViewportEnabledElement) {
    throw new Error('No active enabled element found');
  }

  const { viewportId, renderingEngineId, viewport } = activeViewportEnabledElement;
  const renderingEngine = cornerstoneViewportService.getRenderingEngine();
  if (!renderingEngine) {
    throw new Error('Rendering engine unavailable');
  }

  const captureViewportId = `cornerstone-viewport-capture-${Date.now()}`;
  const captureSize = {
    width: Math.min(width || DEFAULT_SIZE, MAX_TEXTURE_SIZE),
    height: Math.min(height || DEFAULT_SIZE, MAX_TEXTURE_SIZE),
  };

  const container = document.createElement('div');
  container.style.position = 'fixed';
  container.style.left = '-10000px';
  container.style.top = '0';
  container.style.width = `${captureSize.width}px`;
  container.style.height = `${captureSize.height}px`;
  container.style.opacity = '0';
  container.style.pointerEvents = 'none';

  const viewportElement = document.createElement('div');
  viewportElement.setAttribute('data-viewport-uid', captureViewportId);
  viewportElement.style.width = '100%';
  viewportElement.style.height = '100%';
  container.appendChild(viewportElement);
  document.body.appendChild(container);

  const toolGroup = ToolGroupManager.getToolGroupForViewport(viewportId, renderingEngineId);
  const toolModeAndBindings = toolGroup
    ? Object.keys(toolGroup.toolOptions || {}).reduce((acc, toolName) => {
        const tool = toolGroup.toolOptions[toolName];
        if (!tool) {
          return acc;
        }
        const { mode, bindings } = tool;
        return {
          ...acc,
          [toolName]: { mode, bindings },
        };
      }, {})
    : {};

  try {
    renderingEngine.enableElement({
      viewportId: captureViewportId,
      element: viewportElement,
      type: viewport.type,
      defaultOptions: {
        background: viewport.defaultOptions.background,
        orientation: viewport.defaultOptions.orientation,
      },
    });

    const captureViewport = renderingEngine.getViewport(captureViewportId);
    if (!captureViewport) {
      throw new Error('Failed to initialize capture viewport');
    }

    const segmentationRepresentations =
      segmentation.state.getViewportSegmentationRepresentations(viewportId) || [];

    if (captureViewport instanceof StackViewport) {
      const imageId = viewport.getCurrentImageId();
      const properties = viewport.getProperties();
      await captureViewport.setStack([imageId]);
      captureViewport.setProperties(properties);
    } else if (captureViewport instanceof BaseVolumeViewport) {
      const volumeIds = viewport.getAllVolumeIds();
      if (volumeIds?.length) {
        captureViewport.setVolumes([{ volumeId: volumeIds[0] }]);
      }
    }

    if (segmentationRepresentations.length > 0) {
      segmentationRepresentations.forEach(segRepresentation => {
        const { segmentationId, colorLUTIndex, type } = segRepresentation;
        if (type === Enums.SegmentationRepresentations.Labelmap) {
          segmentation.addLabelmapRepresentationToViewportMap({
            [captureViewportId]: [
              {
                segmentationId,
                type: Enums.SegmentationRepresentations.Labelmap,
                config: { colorLUTOrIndex: colorLUTIndex },
              },
            ],
          });
        }

        if (type === Enums.SegmentationRepresentations.Contour) {
          segmentation.addContourRepresentationToViewportMap({
            [captureViewportId]: [
              {
                segmentationId,
                type: Enums.SegmentationRepresentations.Contour,
                config: { colorLUTOrIndex: colorLUTIndex },
              },
            ],
          });
        }
      });
    }

    if (toolGroup) {
      toolGroup.addViewport(captureViewportId, renderingEngineId);
      const toolInstances = toolGroup.getToolInstances();
      Object.values(toolInstances).forEach((toolInstance: any) => {
        if (toolInstance.constructor.isAnnotation !== false) {
          if (showAnnotations) {
            toolGroup.setToolEnabled(toolInstance.toolName);
          } else {
            toolGroup.setToolDisabled(toolInstance.toolName);
          }
        }
      });
    }

    renderingEngine.resize();
    renderingEngine.render();
    await delay(100);

    const canvas = await html2canvas(viewportElement);
    const mimeType = `image/${fileType === 'jpg' ? 'jpeg' : fileType}`;
    const dataUrl = canvas.toDataURL(mimeType, quality);
    const blob: Blob | null = await new Promise(resolve => canvas.toBlob(resolve, mimeType, quality));

    return {
      dataUrl,
      blob,
      width: canvas.width,
      height: canvas.height,
      mimeType,
    };
  } finally {
    Object.keys(toolModeAndBindings).forEach(toolName => {
      const { mode, bindings } = toolModeAndBindings[toolName];
      toolGroup?.setToolMode(toolName, mode, { bindings });
    });
    renderingEngine.disableElement(captureViewportId);
    container.remove();
  }
}
