import { Enums } from '@cornerstonejs/tools';
import { toolNames } from '../initCornerstoneTools';

/** Map cookie/preferences binding string to Cornerstone MouseBindings enum */
const BINDING_STRING_TO_ENUM: Record<string, number> = {
  Primary: Enums.MouseBindings.Primary,
  Secondary: Enums.MouseBindings.Secondary,
  Auxiliary: Enums.MouseBindings.Auxiliary,
  Wheel: Enums.MouseBindings.Wheel,
  None: -1, // no mouse binding
};

const DEFAULT_ACTIVE = [
  {
    toolName: toolNames.WindowLevel,
    bindings: [{ mouseButton: Enums.MouseBindings.Primary }],
  },
  {
    toolName: toolNames.Pan,
    bindings: [{ mouseButton: Enums.MouseBindings.Auxiliary }],
  },
  {
    toolName: toolNames.Zoom,
    bindings: [{ mouseButton: Enums.MouseBindings.Secondary }, { numTouchPoints: 2 }],
  },
  {
    toolName: toolNames.StackScroll,
    bindings: [{ mouseButton: Enums.MouseBindings.Wheel }, { numTouchPoints: 3 }],
  },
];

/**
 * Build overlayViewportTools active array from userPreferences_mousePreferences.bindings (cookie).
 * Cookie format: { "WindowLevel": "Primary", "Zoom": "Auxiliary", "Pan": "Secondary", "StackScroll": "Wheel", "TrackballRotateTool": "None" }
 */
function applyMouseBindingsFromPreferences(
  bindingsFromPrefs: Record<string, string>
): Array<{ toolName: string; bindings: Array<{ mouseButton: number } | { numTouchPoints: number }> }> {
  if (!bindingsFromPrefs || typeof bindingsFromPrefs !== 'object') {
    return DEFAULT_ACTIVE;
  }
  return DEFAULT_ACTIVE.map(entry => {
    const toolName = entry.toolName;
    const prefValue = bindingsFromPrefs[toolName] ?? bindingsFromPrefs[getToolNameForPrefs(toolName)];
    if (prefValue == null) {
      return entry;
    }
    const value = String(prefValue).trim();
    if (value === 'None' || BINDING_STRING_TO_ENUM[value] === -1) {
      return { ...entry, bindings: [] };
    }
    const mouseButton = BINDING_STRING_TO_ENUM[value];
    if (mouseButton != null && mouseButton >= 0) {
      const extra =
        toolName === toolNames.StackScroll
          ? { numTouchPoints: 3 }
          : toolName === toolNames.Zoom
            ? { numTouchPoints: 2 }
            : null;
      return {
        ...entry,
        bindings: extra ? [{ mouseButton }, extra] : [{ mouseButton }],
      };
    }
    return entry;
  });
}

/** Cookie may use "Zoom" / "WindowLevel" etc.; toolNames may differ (e.g. Zoom vs ZoomTool) */
function getToolNameForPrefs(toolName: string): string {
  const map: Record<string, string> = {
    [toolNames.WindowLevel]: 'WindowLevel',
    [toolNames.Pan]: 'Pan',
    [toolNames.Zoom]: 'Zoom',
    [toolNames.StackScroll]: 'StackScroll',
  };
  return map[toolName] ?? toolName;
}

/** Get overlayViewportTools config, merging in mouse preferences from cookies (userPreferences_mousePreferences) when present */
export function getViewportToolsWithMousePreferences(): typeof defaultViewportTools {
  let prefs: { bindings?: Record<string, string> } | null = null;
  if (typeof window !== 'undefined') {
    const getPrefs = (window as Window & { getPreferencesFromCookies?: () => { mousePreferences?: unknown } }).getPreferencesFromCookies;
    if (getPrefs) {
      const raw = getPrefs()?.mousePreferences;
      if (raw != null) {
        if (typeof raw === 'object' && !Array.isArray(raw) && 'bindings' in raw) {
          prefs = raw as { bindings?: Record<string, string> };
        } else if (typeof raw === 'string') {
          try {
            let parsed: unknown = JSON.parse(raw);
            while (typeof parsed === 'string') parsed = JSON.parse(parsed);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && 'bindings' in parsed) {
              prefs = parsed as { bindings?: Record<string, string> };
            }
          } catch (_) {
            /* use default */
          }
        }
      }
    }
  }
  const bindings = prefs?.bindings;
  const active = bindings && typeof bindings === 'object' ? applyMouseBindingsFromPreferences(bindings) : DEFAULT_ACTIVE;
  return {
    'cornerstone.overlayViewportTools': {
      active,
      enabled: [
        {
          toolName: toolNames.PlanarFreehandContourSegmentation,
          configuration: {
            displayOnePointAsCrosshairs: true,
          },
        },
      ],
    },
  };
}

const defaultViewportTools = {
  'cornerstone.overlayViewportTools': {
    active: DEFAULT_ACTIVE,
    enabled: [
      {
        toolName: toolNames.PlanarFreehandContourSegmentation,
        configuration: {
          displayOnePointAsCrosshairs: true,
        },
      },
    ],
  },
};

export default defaultViewportTools;
