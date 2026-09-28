/**
 * Study Panel thumbnail order — thin wrappers around @ohif/core utils so
 * default-extension call sites keep a stable import path.
 */
import { utils } from '@ohif/core';

export function setStudyPanelNavigationOrder(displaySetInstanceUIDs: string[]): void {
  utils.setStudyPanelNavigationOrder(displaySetInstanceUIDs);
}

export function getStudyPanelNavigationOrder(): string[] {
  return utils.getStudyPanelNavigationOrder();
}

export function clearStudyPanelNavigationOrder(): void {
  utils.clearStudyPanelNavigationOrder();
}

export function subscribeStudyPanelNavigationOrder(listener: () => void): () => void {
  return utils.subscribeStudyPanelNavigationOrder(listener);
}
