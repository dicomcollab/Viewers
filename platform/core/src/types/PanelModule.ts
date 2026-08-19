import { PubSubService } from '../services';

type Panel = {
  id?: string;
  name: string;
  iconName: string;
  iconLabel: string;
  label: string;
  component: React.FC;
};

type ActivatePanelTriggers = {
  sourcePubSubService: PubSubService;
  sourceEvents: string[];
};

interface PanelEvent {
  panelId: string;
}

interface ActivatePanelEvent extends PanelEvent {
  forceActive: boolean;
  /**
   * Expands the side panel even when the user collapsed it manually. Only set
   * this for panels opened by an explicit user action.
   */
  forceExpand?: boolean;
}

export type { ActivatePanelEvent, ActivatePanelTriggers, Panel, PanelEvent };
