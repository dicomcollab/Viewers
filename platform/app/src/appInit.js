import {
  CommandsManager,
  ExtensionManager,
  ServicesManager,
  ServiceProvidersManager,
  HotkeysManager,
  UINotificationService,
  UIModalService,
  UIDialogService,
  UIViewportDialogService,
  MeasurementService,
  DisplaySetService,
  ToolbarService,
  ViewportGridService,
  HangingProtocolService,
  CineService,
  UserAuthenticationService,
  errorHandler,
  CustomizationService,
  PanelService,
  WorkflowStepsService,
  StudyPrefetcherService,
  MultiMonitorService,
  isRedirectToRisOn401Enabled,
  resolveRis401RedirectUrlFromConfig,
  // utils,
} from '@ohif/core';

import loadModules, { loadModule as peerImport } from './pluginImports';
import { publicUrl } from './utils/publicUrl';
import getHangingProtocolModule from './hangingProtocols';

/**
 * @param {object|func} appConfigOrFunc - application configuration, or a function that returns application configuration
 * @param {object[]} defaultExtensions - array of extension objects
 */
async function appInit(appConfigOrFunc, defaultExtensions, defaultModes) {
  const commandsManagerConfig = {
    getAppState: () => {},
  };

  const commandsManager = new CommandsManager(commandsManagerConfig);
  const servicesManager = new ServicesManager(commandsManager);
  const serviceProvidersManager = new ServiceProvidersManager();
  const hotkeysManager = new HotkeysManager(commandsManager, servicesManager);

  const appConfig = {
    ...(typeof appConfigOrFunc === 'function'
      ? await appConfigOrFunc({ servicesManager, peerImport })
      : appConfigOrFunc),
  };
  // Default the peer import function
  appConfig.peerImport ||= peerImport;
  appConfig.measurementTrackingMode ||= 'standard';
  appConfig.routerBasename ||= publicUrl;

  const extensionManager = new ExtensionManager({
    commandsManager,
    servicesManager,
    serviceProvidersManager,
    hotkeysManager,
    appConfig,
  });

  servicesManager.setExtensionManager(extensionManager);

  servicesManager.registerServices([
    [MultiMonitorService.REGISTRATION, appConfig.multimonitor],
    UINotificationService.REGISTRATION,
    UIModalService.REGISTRATION,
    UIDialogService.REGISTRATION,
    UIViewportDialogService.REGISTRATION,
    MeasurementService.REGISTRATION,
    DisplaySetService.REGISTRATION,
    [CustomizationService.REGISTRATION, appConfig.customizationService],
    ToolbarService.REGISTRATION,
    ViewportGridService.REGISTRATION,
    HangingProtocolService.REGISTRATION,
    CineService.REGISTRATION,
    UserAuthenticationService.REGISTRATION,
    PanelService.REGISTRATION,
    WorkflowStepsService.REGISTRATION,
    [StudyPrefetcherService.REGISTRATION, appConfig.studyPrefetcher],
  ]);

  // Store servicesManager reference in errorHandler for later access
  errorHandler.setServicesManager(servicesManager);

  // Create enhanced error handler that checks for 401 (unauthorized) errors
  // and redirects to login if token expires
  const createEnhancedErrorHandler = (originalHandler) => {
    return (error) => {
      const status = error?.status ?? error?.statusCode;

      if (status === 406) {
        if (typeof window !== 'undefined' && typeof window.handleDataSource406 === 'function') {
          window.handleDataSource406({ source: 'http-error-handler' });
        }
        if (typeof originalHandler === 'function') {
          originalHandler(error);
        }
        return;
      }

      // Check if error is a 401 (Unauthorized) - token expired
      if (error && status === 401) {
        // Get userAuthenticationService from stored servicesManager
        const userAuthenticationService = errorHandler._servicesManager?.services?.userAuthenticationService;

        // Check if userAuthenticationService has handleUnauthenticated method
        if (userAuthenticationService && typeof userAuthenticationService.handleUnauthenticated === 'function') {
          userAuthenticationService.handleUnauthenticated();
          return;
        }
        // Fallback: redirect to RIS URL if no handler is available
        if (typeof window !== 'undefined') {
          const appConfig = errorHandler._servicesManager?.extensionManager?.appConfig || window.config || {};
          if (isRedirectToRisOn401Enabled(appConfig)) {
            const target = resolveRis401RedirectUrlFromConfig(appConfig);
            console.log('401 error - redirecting to RIS:', target);
            window.location.href = target;
          }
        }
        return;
      }

      // Call original error handler if provided
      if (typeof originalHandler === 'function') {
        return originalHandler(error);
      }
    };
  };

  errorHandler.getHTTPErrorHandler = () => {
    const originalHandler = typeof appConfig.httpErrorHandler === 'function'
      ? appConfig.httpErrorHandler
      : null;

    // Return enhanced handler that checks for 401 errors
    return createEnhancedErrorHandler(originalHandler);
  };

  // Register custom hanging protocols EARLY, before extensions are loaded
  // This ensures our protocol is available when studies are loaded
  const { hangingProtocolService } = servicesManager.services;
  const customHangingProtocols = getHangingProtocolModule();
  customHangingProtocols.forEach(({ name, protocol }) => {
    if (protocol) {
      hangingProtocolService.addProtocol(name, protocol);
      console.log('✅ Registered custom hanging protocol:', name, 'with ID:', protocol.id);
    }
  });

  /**
   * Example: [ext1, ext2, ext3]
   * Example2: [[ext1, config], ext2, [ext3, config]]
   */
  const loadedExtensions = await loadModules([...defaultExtensions, ...appConfig.extensions]);
  await extensionManager.registerExtensions(loadedExtensions, appConfig.dataSources);

  // TODO: We no longer use `utils.addServer`
  // TODO: We no longer init webWorkers at app level
  // TODO: We no longer init the user Manager

  if (!appConfig.modes) {
    throw new Error('No modes are defined! Check your app-config.js');
  }

  const loadedModes = await loadModules([...(appConfig.modes || []), ...defaultModes]);

  // This is the name for the loaded instance object
  appConfig.loadedModes = [];
  const modesById = new Set();
  for (let i = 0; i < loadedModes.length; i++) {
    let mode = loadedModes[i];
    if (!mode) {
      continue;
    }
    const { id } = mode;

    if (mode.modeFactory) {
      // If the appConfig contains configuration for this mode, use it.
      const modeConfiguration =
        appConfig.modesConfiguration && appConfig.modesConfiguration[id]
          ? appConfig.modesConfiguration[id]
          : {};

      mode = await mode.modeFactory({ modeConfiguration, loadModules });
    }

    if (modesById.has(id)) {
      continue;
    }
    // Prevent duplication
    modesById.add(id);
    if (!mode || typeof mode !== 'object') {
      continue;
    }
    appConfig.loadedModes.push(mode);
  }
  // Hack alert - don't touch the original modes definition,
  // but there are still dependencies on having the appConfig modes defined
  appConfig.modes = appConfig.loadedModes;

  return {
    appConfig,
    commandsManager,
    extensionManager,
    servicesManager,
    serviceProvidersManager,
    hotkeysManager,
  };
}

export default appInit;
