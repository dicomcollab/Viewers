import {
  PanTool,
  WindowLevelTool,
  SegmentBidirectionalTool,
  StackScrollTool,
  VolumeRotateTool,
  ZoomTool,
  MIPJumpToClickTool,
  LengthTool,
  RectangleROITool,
  RectangleROIThresholdTool,
  EllipticalROITool,
  CircleROITool,
  BidirectionalTool,
  ArrowAnnotateTool,
  DragProbeTool,
  ProbeTool,
  AngleTool,
  CobbAngleTool,
  MagnifyTool,
  CrosshairsTool,
  RectangleScissorsTool,
  SphereScissorsTool,
  CircleScissorsTool,
  BrushTool,
  PaintFillTool,
  init,
  addTool,
  annotation,
  ToolGroupManager,
  Enums,
  ReferenceLinesTool,
  TrackballRotateTool,
  AdvancedMagnifyTool,
  UltrasoundDirectionalTool,
  UltrasoundPleuraBLineTool,
  PlanarFreehandROITool,
  PlanarFreehandContourSegmentationTool,
  SplineROITool,
  LivewireContourTool,
  OrientationMarkerTool,
  WindowLevelRegionTool,
  SegmentSelectTool,
  RegionSegmentPlusTool,
  SegmentLabelTool,
  LivewireContourSegmentationTool,
  SculptorTool,
  SplineContourSegmentationTool,
  LabelMapEditWithContourTool,
} from '@cornerstonejs/tools';
import { LabelmapSlicePropagationTool, MarkerLabelmapTool } from '@cornerstonejs/ai';
import * as polySeg from '@cornerstonejs/polymorphic-segmentation';

import CalibrationLineTool from './tools/CalibrationLineTool';
import ImageOverlayViewerTool from './tools/ImageOverlayViewerTool';
import { resolveRisPreferencesApiBaseUrlLocal } from './utils/risRedirectConfig.js';

// Function to get token from cookie
function getTokenFromCookie() {
  const name = 'token=';
  const decodedCookie = decodeURIComponent(document.cookie);
  const cookies = decodedCookie.split(';');
  for (let cookie of cookies) {
    cookie = cookie.trim();
    if (cookie.indexOf(name) === 0) {
      return cookie.substring(name.length);
    }
  }
  return null;
}

// Function to fetch preferences from API
async function fetchPreferences() {
  try {
    const token = getTokenFromCookie();
    if (!token) {
      console.warn('No token found in cookie');
      return null;
    }

    let backendUrl;
    if (typeof process !== 'undefined' && process.env && process.env.REACT_APP_BACKEND_HOTKEY_URL) {
      backendUrl = String(process.env.REACT_APP_BACKEND_HOTKEY_URL).replace(/\/$/, '');
    } else if (typeof window !== 'undefined' && window.config && window.config.backendHotkeyUrl) {
      backendUrl = String(window.config.backendHotkeyUrl).replace(/\/$/, '');
    } else {
      backendUrl = resolveRisPreferencesApiBaseUrlLocal(
        typeof window !== 'undefined' ? window.config : undefined
      );
    }

    const response = await fetch(`${backendUrl}/getPreferences`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        Token: token,
      },
    });
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const data = await response.json();
    //console.log('Preferences fetched successfully:', data);
    return data;
  } catch (error) {
    console.error('Error fetching preferences:', error);
    return null;
  }
}

export default async function initCornerstoneTools(configuration = {}) {
  CrosshairsTool.isAnnotation = false;
  LabelmapSlicePropagationTool.isAnnotation = false;
  MarkerLabelmapTool.isAnnotation = false;
  ReferenceLinesTool.isAnnotation = false;
  AdvancedMagnifyTool.isAnnotation = false;
  PlanarFreehandContourSegmentationTool.isAnnotation = false;

  try {
    // Initialize Cornerstone tools with the provided configuration
    init({
      ...configuration,
      addons: {
        polySeg,
        ...(configuration.addons || {}),
      },
      computeWorker: {
        autoTerminateOnIdle: {
          enabled: false,
        },
        ...(configuration.computeWorker || {}),
      },
    });

    // Add all available tools to the Cornerstone toolset
    addTool(PanTool);
    addTool(SegmentBidirectionalTool);
    addTool(WindowLevelTool);
    addTool(StackScrollTool);
    addTool(VolumeRotateTool);
    addTool(ZoomTool);
    addTool(ProbeTool);
    addTool(MIPJumpToClickTool);
    addTool(LengthTool);
    addTool(RectangleROITool);
    addTool(RectangleROIThresholdTool);
    addTool(EllipticalROITool);
    addTool(CircleROITool);
    addTool(BidirectionalTool);
    addTool(ArrowAnnotateTool);
    addTool(DragProbeTool);
    addTool(AngleTool);
    addTool(CobbAngleTool);
    addTool(MagnifyTool);
    addTool(CrosshairsTool);
    addTool(RectangleScissorsTool);
    addTool(SphereScissorsTool);
    addTool(CircleScissorsTool);
    addTool(BrushTool);
    addTool(PaintFillTool);
    addTool(ReferenceLinesTool);
    addTool(CalibrationLineTool);
    addTool(TrackballRotateTool);
    addTool(ImageOverlayViewerTool);
    addTool(AdvancedMagnifyTool);
    addTool(UltrasoundDirectionalTool);
    addTool(UltrasoundPleuraBLineTool);
    addTool(PlanarFreehandROITool);
    addTool(SplineROITool);
    addTool(LivewireContourTool);
    addTool(OrientationMarkerTool);
    addTool(WindowLevelRegionTool);
    addTool(PlanarFreehandContourSegmentationTool);
    addTool(SegmentSelectTool);
    addTool(SegmentLabelTool);
    addTool(LabelmapSlicePropagationTool);
    addTool(MarkerLabelmapTool);
    addTool(RegionSegmentPlusTool);
    addTool(LivewireContourSegmentationTool);
    addTool(SculptorTool);
    addTool(SplineContourSegmentationTool);
    addTool(LabelMapEditWithContourTool);

    // Create a mapping between database tool names and Cornerstone tool names
    const toolNameMapping = {
      AngleTool: AngleTool.toolName,
      LengthTool: LengthTool.toolName,
      RectangleROITool: RectangleROITool.toolName,
      CircleROITool: CircleROITool.toolName,
      EllipticalROITool: EllipticalROITool.toolName,
      BidirectionalTool: BidirectionalTool.toolName,
      ArrowAnnotateTool: ArrowAnnotateTool.toolName,
      ProbeTool: ProbeTool.toolName,
      CobbAngleTool: CobbAngleTool.toolName,
      DragProbeTool: DragProbeTool.toolName,
      RectangleROIThresholdTool: RectangleROIThresholdTool.toolName,
      PanTool: PanTool.toolName,
      WindowLevelTool: WindowLevelTool.toolName,
      StackScrollTool: StackScrollTool.toolName,
      VolumeRotateTool: VolumeRotateTool.toolName,
      Zoom: ZoomTool.toolName,
      MIPJumpToClickTool: MIPJumpToClickTool.toolName,
      MagnifyTool: MagnifyTool.toolName,
      CrosshairsTool: CrosshairsTool.toolName,
      BrushTool: BrushTool.toolName,
      PaintFillTool: PaintFillTool.toolName,
      ReferenceLinesTool: ReferenceLinesTool.toolName,
      CalibrationLineTool: CalibrationLineTool.toolName,
      TrackballRotateTool: TrackballRotateTool.toolName,
      CircleScissorsTool: CircleScissorsTool.toolName,
      RectangleScissorsTool: RectangleScissorsTool.toolName,
      SphereScissorsTool: SphereScissorsTool.toolName,
      ImageOverlayViewerTool: ImageOverlayViewerTool.toolName,
      AdvancedMagnifyTool: AdvancedMagnifyTool.toolName,
      UltrasoundDirectionalTool: UltrasoundDirectionalTool.toolName,
      SplineROITool: SplineROITool.toolName,
      LivewireContourTool: LivewireContourTool.toolName,
      PlanarFreehandROITool: PlanarFreehandROITool.toolName,
      OrientationMarkerTool: OrientationMarkerTool.toolName,
      WindowLevelRegionTool: WindowLevelRegionTool.toolName,
      PlanarFreehandContourSegmentationTool: PlanarFreehandContourSegmentationTool.toolName,
      SegmentBidirectionalTool: SegmentBidirectionalTool.toolName,
      SegmentSelectTool: SegmentSelectTool.toolName,
      SegmentLabelTool: SegmentLabelTool.toolName,
      LabelmapSlicePropagationTool: LabelmapSlicePropagationTool.toolName,
      MarkerLabelmapTool: MarkerLabelmapTool.toolName,
      RegionSegmentPlusTool: RegionSegmentPlusTool.toolName,
      LivewireContourSegmentationTool: LivewireContourSegmentationTool.toolName,
      SculptorTool: SculptorTool.toolName,
      SplineContourSegmentationTool: SplineContourSegmentationTool.toolName,
      LabelMapEditWithContourTool: LabelMapEditWithContourTool.toolName,
      UltrasoundPleuraBLineTool: UltrasoundPleuraBLineTool.toolName,
    };

    // Use shared preferences from config when available (single API call for app); else fetch here
    const getPrefs =
      typeof window !== 'undefined' && window.fetchPreferences
        ? window.fetchPreferences
        : fetchPreferences;
    const preferences = await getPrefs();

    // Get the current default styles
    const defaultStyles = annotation.config.style.getDefaultToolStyles();

    // Create a new styles object to merge with default styles
    const newStyles = {
      global: {
        ...defaultStyles.global,
      },
    };

    // Apply global colors from API preferences if available, otherwise use defaults
    const globalLineColor =
      preferences && preferences.globalLineColor ? preferences.globalLineColor : 'rgb(0, 220, 0)';
    const globalTextBoxColor =
      preferences && preferences.globalTextColor ? preferences.globalTextColor : 'rgb(0, 255, 0)';

    // Apply styles from preferences (API or cookies: userPreferences_tools)
    let toolsArray = preferences?.tools;
    if (typeof toolsArray === 'string') {
      try {
        toolsArray = JSON.parse(toolsArray);
      } catch (_) {
        toolsArray = null;
      }
    }
    if (preferences && toolsArray && Array.isArray(toolsArray) && toolsArray.length > 0) {
      console.log('Applying styles from preferences (tools)...');

      // Create a map of tool-specific configurations for quick lookup
      const toolSpecificConfigs = {};

      toolsArray.forEach(toolConfig => {
        const toolId = toolConfig?.toolId ?? toolConfig;
        const dbToolName = toolId?.name ?? toolConfig?.toolName;
        const lineColor = toolConfig?.lineColor ?? toolId?.lineColor;
        const textBoxColor = toolConfig?.textBoxColor ?? toolId?.textBoxColor;
        if (!dbToolName) return;
        const cornerstoneToolName = toolNameMapping[dbToolName];

        if (cornerstoneToolName && (lineColor || textBoxColor)) {
          toolSpecificConfigs[cornerstoneToolName] = {
            lineColor: lineColor || undefined,
            textBoxColor: textBoxColor || undefined,
          };
        }
      });

      // Apply styles to all tools with priority: tool-specific config first, then global config
      Object.values(toolNameMapping).forEach(cornerstoneToolName => {
        const toolSpecificConfig = toolSpecificConfigs[cornerstoneToolName];

        // Use tool-specific colors if available, otherwise fall back to global colors
        const finalLineColor = toolSpecificConfig?.lineColor || globalLineColor;
        const finalTextBoxColor = toolSpecificConfig?.textBoxColor || globalTextBoxColor;

        console.log(`Applying styles to tool: ${cornerstoneToolName}`, {
          lineColor: finalLineColor,
          textBoxColor: finalTextBoxColor,
          source: toolSpecificConfig ? 'tool-specific' : 'global',
        });

        newStyles[cornerstoneToolName] = {
          ...(defaultStyles[cornerstoneToolName] || {}),
          textBoxFontSize: '15px',
          lineWidth: '1.5',
          color: finalLineColor,
          colorHighlighted: finalLineColor,
          colorLocked: finalLineColor,
          colorSelected: finalLineColor,
          textBoxColor: finalTextBoxColor,
          textBoxColorHighlighted: finalTextBoxColor,
          textBoxColorLocked: finalTextBoxColor,
          textBoxColorSelected: finalTextBoxColor,
        };
      });
    } else {
      console.log('No preferences found or API call failed, applying default global colors');
      // Apply default global colors to all tools if no preferences
      Object.values(toolNameMapping).forEach(cornerstoneToolName => {
        newStyles[cornerstoneToolName] = {
          ...(defaultStyles[cornerstoneToolName] || {}),
          textBoxFontSize: '15px',
          lineWidth: '1.5',
          color: globalLineColor,
          colorHighlighted: globalLineColor,
          colorLocked: globalLineColor,
          colorSelected: globalLineColor,
          textBoxColor: globalTextBoxColor,
          textBoxColorHighlighted: globalTextBoxColor,
          textBoxColorLocked: globalTextBoxColor,
          textBoxColorSelected: globalTextBoxColor,
        };
      });
    }

    // Set the updated styles
    annotation.config.style.setDefaultToolStyles(newStyles);

    console.log('Final tool styles:', annotation.config.style.getDefaultToolStyles());
  } catch (error) {
    console.error('Error initializing Cornerstone tools:', error);
    throw error;
  }
}

const toolNames = {
  Pan: PanTool.toolName,
  ArrowAnnotate: ArrowAnnotateTool.toolName,
  WindowLevel: WindowLevelTool.toolName,
  StackScroll: StackScrollTool.toolName,
  Zoom: ZoomTool.toolName,
  VolumeRotate: VolumeRotateTool.toolName,
  MipJumpToClick: MIPJumpToClickTool.toolName,
  Length: LengthTool.toolName,
  DragProbe: DragProbeTool.toolName,
  Probe: ProbeTool.toolName,
  RectangleROI: RectangleROITool.toolName,
  RectangleROIThreshold: RectangleROIThresholdTool.toolName,
  EllipticalROI: EllipticalROITool.toolName,
  CircleROI: CircleROITool.toolName,
  Bidirectional: BidirectionalTool.toolName,
  Angle: AngleTool.toolName,
  CobbAngle: CobbAngleTool.toolName,
  Magnify: MagnifyTool.toolName,
  Crosshairs: CrosshairsTool.toolName,
  Brush: BrushTool.toolName,
  PaintFill: PaintFillTool.toolName,
  ReferenceLines: ReferenceLinesTool.toolName,
  CalibrationLine: CalibrationLineTool.toolName,
  TrackballRotateTool: TrackballRotateTool.toolName,
  CircleScissors: CircleScissorsTool.toolName,
  RectangleScissors: RectangleScissorsTool.toolName,
  SphereScissors: SphereScissorsTool.toolName,
  ImageOverlayViewer: ImageOverlayViewerTool.toolName,
  AdvancedMagnify: AdvancedMagnifyTool.toolName,
  UltrasoundDirectional: UltrasoundDirectionalTool.toolName,
  UltrasoundAnnotation: UltrasoundPleuraBLineTool.toolName,
  SplineROI: SplineROITool.toolName,
  LivewireContour: LivewireContourTool.toolName,
  PlanarFreehandROI: PlanarFreehandROITool.toolName,
  OrientationMarker: OrientationMarkerTool.toolName,
  WindowLevelRegion: WindowLevelRegionTool.toolName,
  PlanarFreehandContourSegmentation: PlanarFreehandContourSegmentationTool.toolName,
  SegmentBidirectional: SegmentBidirectionalTool.toolName,
  SegmentSelect: SegmentSelectTool.toolName,
  SegmentLabel: SegmentLabelTool.toolName,
  LabelmapSlicePropagation: LabelmapSlicePropagationTool.toolName,
  MarkerLabelmap: MarkerLabelmapTool.toolName,
  RegionSegmentPlus: RegionSegmentPlusTool.toolName,
  LivewireContourSegmentation: LivewireContourSegmentationTool.toolName,
  SculptorTool: SculptorTool.toolName,
  SplineContourSegmentation: SplineContourSegmentationTool.toolName,
  LabelMapEditWithContourTool: LabelMapEditWithContourTool.toolName,
};

export { toolNames };

function applyDefaultAnnotationColors() {
  try {
    const defaultLine = 'rgb(0, 220, 0)';
    const defaultText = 'rgb(0, 255, 0)';
    const current = annotation.config.style.getDefaultToolStyles() || {};
    const next = { global: { ...(current.global || {}) } };
    Object.keys(current).forEach(key => {
      if (key === 'global') {
        return;
      }
      next[key] = {
        ...current[key],
        color: defaultLine,
        colorHighlighted: defaultLine,
        colorLocked: defaultLine,
        colorSelected: defaultLine,
        textBoxColor: defaultText,
        textBoxColorHighlighted: defaultText,
        textBoxColorLocked: defaultText,
        textBoxColorSelected: defaultText,
      };
    });
    annotation.config.style.setDefaultToolStyles(next);
  } catch (error) {
    console.warn('[applyDefaultAnnotationColors]', error);
  }
}

function applyDefaultMouseBindings() {
  try {
    const groups = ToolGroupManager.getAllToolGroups?.() || [];
    const defaults = [
      {
        toolName: toolNames.WindowLevel,
        bindings: [{ mouseButton: Enums.MouseBindings.Primary }],
      },
      {
        toolName: toolNames.Zoom,
        bindings: [{ mouseButton: Enums.MouseBindings.Secondary }, { numTouchPoints: 2 }],
      },
      {
        toolName: toolNames.Pan,
        bindings: [{ mouseButton: Enums.MouseBindings.Auxiliary }],
      },
      {
        toolName: toolNames.StackScroll,
        bindings: [{ mouseButton: Enums.MouseBindings.Wheel }, { numTouchPoints: 3 }],
      },
    ];
    groups.forEach(group => {
      defaults.forEach(({ toolName, bindings }) => {
        if (group.hasTool?.(toolName)) {
          group.setToolActive(toolName, { bindings });
        }
      });
      if (group.hasTool?.(toolNames.TrackballRotateTool)) {
        group.setToolPassive?.(toolNames.TrackballRotateTool);
      }
    });
  } catch (error) {
    console.warn('[applyDefaultMouseBindings]', error);
  }
}

function applyDefaultViewerInteractionPreferences() {
  applyDefaultAnnotationColors();
  applyDefaultMouseBindings();
}

if (typeof window !== 'undefined') {
  window.applyDefaultViewerInteractionPreferences = applyDefaultViewerInteractionPreferences;
}
