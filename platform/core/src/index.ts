import { ExtensionManager, MODULE_TYPES } from './extensions';
import { ServiceProvidersManager, ServicesManager } from './services';
import classes, { CommandsManager, HotkeysManager } from './classes';
import { SystemContextProvider, useSystem } from './contextProviders/SystemProvider';
import { ViewportRefsProvider } from './hooks/useViewportRef';

import DICOMWeb from './DICOMWeb';
import errorHandler from './errorHandler.js';
import log from './log.js';
import object from './object.js';
import string from './string.js';
import user from './user';
import utils from './utils';
import {
  fetchRisViewDicomImg,
  getDefaultRisApiBase,
  getDefaultRisLoginUrl,
  getDefaultRisPortalOrigin,
  getDefaultRisWorklistUrl,
  getRisAuthTokenFromBrowserCookies,
  isRedirectToRisOn401Enabled,
  resolveRis401RedirectUrlFromConfig,
  resolveRisApiBaseFromConfig,
  resolveRisPreferencesApiBaseUrl,
  resolveRisRootRedirectUrlFromConfig,
  resolveRisWorklistUrlFromConfig,
} from './utils/risEnvironmentDefaults';
import defaults from './defaults';
import * as Types from './types';
import * as Enums from './enums';
import {
  CineService,
  UIDialogService,
  UIModalService,
  UINotificationService,
  UIViewportDialogService,
  //
  DicomMetadataStore,
  DisplaySetService,
  ToolbarService,
  MeasurementService,
  ViewportGridService,
  HangingProtocolService,
  pubSubServiceInterface,
  PubSubService,
  UserAuthenticationService,
  CustomizationService,
  PanelService,
  WorkflowStepsService,
  StudyPrefetcherService,
  MultiMonitorService,
} from './services';

import { DisplaySetMessage, DisplaySetMessageList } from './services/DisplaySetService';

import IWebApiDataSource from './DataSources/IWebApiDataSource';
import useActiveViewportDisplaySets from './hooks/useActiveViewportDisplaySets';

export * from './hooks';

const hotkeys = {
  ...utils.hotkeys,
  defaults: { hotkeyBindings: defaults.hotkeyBindings },
};

const OHIF = {
  MODULE_TYPES,
  //
  CommandsManager,
  ExtensionManager,
  HotkeysManager,
  ServicesManager,
  ServiceProvidersManager,
  //
  defaults,
  utils,
  hotkeys,
  classes,
  string,
  user,
  errorHandler,
  object,
  log,
  DICOMWeb,
  viewer: {},
  //
  CineService,
  CustomizationService,
  UIDialogService,
  UIModalService,
  UINotificationService,
  UIViewportDialogService,
  DisplaySetService,
  MeasurementService,
  ToolbarService,
  ViewportGridService,
  HangingProtocolService,
  UserAuthenticationService,
  MultiMonitorService,
  IWebApiDataSource,
  DicomMetadataStore,
  pubSubServiceInterface,
  PubSubService,
  PanelService,
  useActiveViewportDisplaySets,
  WorkflowStepsService,
  StudyPrefetcherService,
};

export {
  fetchRisViewDicomImg,
  getDefaultRisApiBase,
  getDefaultRisLoginUrl,
  getDefaultRisPortalOrigin,
  getDefaultRisWorklistUrl,
  getRisAuthTokenFromBrowserCookies,
  isRedirectToRisOn401Enabled,
  resolveRis401RedirectUrlFromConfig,
  resolveRisApiBaseFromConfig,
  resolveRisPreferencesApiBaseUrl,
  resolveRisRootRedirectUrlFromConfig,
  resolveRisWorklistUrlFromConfig,
  MODULE_TYPES,
  //
  CommandsManager,
  ExtensionManager,
  HotkeysManager,
  ServicesManager,
  ServiceProvidersManager,
  SystemContextProvider,
  ViewportRefsProvider,
  //
  defaults,
  utils,
  hotkeys,
  classes,
  string,
  user,
  errorHandler,
  object,
  log,
  DICOMWeb,
  //
  CineService,
  CustomizationService,
  UIDialogService,
  UIModalService,
  UINotificationService,
  UIViewportDialogService,
  DisplaySetService,
  DisplaySetMessage,
  DisplaySetMessageList,
  MeasurementService,
  MultiMonitorService,
  ToolbarService,
  ViewportGridService,
  HangingProtocolService,
  UserAuthenticationService,
  IWebApiDataSource,
  DicomMetadataStore,
  pubSubServiceInterface,
  PubSubService,
  Enums,
  PanelService,
  WorkflowStepsService,
  StudyPrefetcherService,
  useSystem,
  useActiveViewportDisplaySets,
};

export { OHIF };

export type { Types };
export type {
  RisAppConfigSlice,
  RisViewDicomImgResult,
} from './utils/risEnvironmentDefaults';
export type { SortDisplaySetsCopyOptions } from './utils/sortStudy';

export default OHIF;
