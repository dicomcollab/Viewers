// External

import React, { useEffect, useState } from 'react';
import PropTypes from 'prop-types';
import i18n from '@ohif/i18n';
import { I18nextProvider } from 'react-i18next';
import { BrowserRouter, type BrowserRouterProps, useNavigate } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';

import Compose from './routes/Mode/Compose';
import {
  ExtensionManager,
  CommandsManager,
  HotkeysManager,
  ServiceProvidersManager,
  SystemContextProvider,
  ViewportRefsProvider,
  isRedirectToRisOn401Enabled,
  resolveRis401RedirectUrlFromConfig,
  shouldSuppressBenignViewerError,
} from '@ohif/core';
import {
  ThemeWrapper as ThemeWrapperNext,
  NotificationProvider,
  ViewportGridProvider,
  DialogProvider,
  CineProvider,
  TooltipProvider,
  Modal as ModalNext,
  ManagedDialog,
  ModalProvider,
  ViewportDialogProvider,
  UserAuthenticationProvider,
} from '@ohif/ui-next';
// Viewer Project
// TODO: Should this influence study list?
import { AppConfigProvider } from '@state';
import createRoutes from './routes';
import appInit from './appInit.js';
import OpenIdConnectRoutes from './utils/OpenIdConnectRoutes';
import { ShepherdJourneyProvider } from 'react-shepherd';
import { getCookie } from './utils/cookieUtils';
import { queryClient } from './utils/queryClient';
import RisPostMessageBridge from './components/RisPostMessageBridge';
import './App.css';

let commandsManager: CommandsManager,
  extensionManager: ExtensionManager,
  servicesManager: AppTypes.ServicesManager,
  serviceProvidersManager: ServiceProvidersManager,
  hotkeysManager: HotkeysManager;

const routerFutureFlags: BrowserRouterProps['future'] = {
  v7_startTransition: true,
  v7_relativeSplatPath: true,
};

function App({
  config = {
    /**
     * Relative route from domain root that OHIF instance is installed at.
     * For example:
     *
     * Hosted at: https://ohif.org/where-i-host-the/viewer/
     * Value: `/where-i-host-the/viewer/`
     * */
    routerBasename: '/',
    /**
     *
     */
    showLoadingIndicator: true,
    showStudyList: true,
    oidc: [],
    extensions: [],
  },
  defaultExtensions = [],
  defaultModes = [],
}) {
  const [init, setInit] = useState(null);
  useEffect(() => {
    const run = async () => {
      appInit(config, defaultExtensions, defaultModes).then(setInit).catch(console.error);
    };

    run();
  }, []);

  // Suppress known transient VTK shader crash during rapid advanced layout switches
  // (MPR/axial-primary/3D). This prevents the React runtime overlay from interrupting workflow.
  useEffect(() => {
    const onWindowError = (event: ErrorEvent) => {
      const message = event?.message ?? '';
      const stack = event?.error?.stack ?? '';
      if (shouldSuppressBenignViewerError(message) || shouldSuppressBenignViewerError(stack)) {
        event.preventDefault();
        event.stopImmediatePropagation?.();
      }
    };

    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      const reason = event?.reason as any;
      const reasonMessage = reason?.message ?? (typeof reason === 'string' ? reason : '');
      const reasonStack = reason?.stack ?? '';
      const reasonText =
        reasonMessage ||
        (reason && typeof reason === 'object' ? JSON.stringify(reason) : String(reason ?? ''));
      if (
        shouldSuppressBenignViewerError(reasonText) ||
        shouldSuppressBenignViewerError(reasonStack)
      ) {
        event.preventDefault();
        event.stopImmediatePropagation?.();
      }
    };

    const previousOnError = window.onerror;
    window.onerror = function (message, source, lineno, colno, error) {
      const msg = typeof message === 'string' ? message : String(message ?? '');
      const stack = (error as any)?.stack ?? '';
      if (shouldSuppressBenignViewerError(msg) || shouldSuppressBenignViewerError(stack)) {
        return true;
      }
      if (typeof previousOnError === 'function') {
        return previousOnError(message, source, lineno, colno, error);
      }
      return false;
    };

    const patchRuntimeOverlayHook = () => {
      const w = window as any;
      const hook = w.__REACT_ERROR_OVERLAY_GLOBAL_HOOK__;
      if (!hook || hook.__ohifIsAttributeUsedGuardPatched) {
        return;
      }
      const originalReportRuntimeError = hook.reportRuntimeError;
      if (typeof originalReportRuntimeError !== 'function') {
        return;
      }

      hook.reportRuntimeError = (error: unknown) => {
        const msg = (error as any)?.message ?? String(error ?? '');
        const stack = (error as any)?.stack ?? '';
        if (shouldSuppressBenignViewerError(msg) || shouldSuppressBenignViewerError(stack)) {
          return;
        }
        return originalReportRuntimeError.call(hook, error);
      };
      hook.__ohifIsAttributeUsedGuardPatched = true;
    };

    patchRuntimeOverlayHook();
    const overlayPatchTimer = window.setInterval(patchRuntimeOverlayHook, 500);

    window.addEventListener('error', onWindowError);
    window.addEventListener('unhandledrejection', onUnhandledRejection);

    return () => {
      window.clearInterval(overlayPatchTimer);
      window.onerror = previousOnError ?? null;
      window.removeEventListener('error', onWindowError);
      window.removeEventListener('unhandledrejection', onUnhandledRejection);
    };
  }, []);

  if (!init) {
    if (config.showLoadingIndicator === false) {
      return null;
    }

    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '100vw',
          height: '100vh',
          background: '#000',
          color: '#b0b8c4',
        }}
      >
        <div style={{ textAlign: 'center' }}>
          <div
            style={{
              width: '2.5rem',
              height: '2.5rem',
              margin: '0 auto 1rem',
              border: '3px solid #2d3548',
              borderTopColor: '#7aa2f7',
              borderRadius: '50%',
              animation: 'ohif-app-init-spin 0.9s linear infinite',
            }}
          />
          <p style={{ margin: 0 }}>Loading viewer…</p>
        </div>
        <style>{`@keyframes ohif-app-init-spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  // Set above for named export
  commandsManager = init.commandsManager;
  extensionManager = init.extensionManager;
  servicesManager = init.servicesManager;
  serviceProvidersManager = init.serviceProvidersManager;
  hotkeysManager = init.hotkeysManager;

  // Set appConfig
  const appConfigState = init.appConfig;
  const { routerBasename, modes, dataSources, oidc, showStudyList } = appConfigState;

  // get the maximum 3D texture size
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl2');

  if (gl) {
    const max3DTextureSize = gl.getParameter(gl.MAX_3D_TEXTURE_SIZE);
    appConfigState.max3DTextureSize = max3DTextureSize;
  }

  const {
    uiDialogService,
    uiModalService,
    uiViewportDialogService,
    viewportGridService,
    cineService,
    userAuthenticationService,
    uiNotificationService,
    customizationService,
  } = servicesManager.services;

  const providers = [
    [QueryClientProvider, { client: queryClient } as any],
    [AppConfigProvider, { value: appConfigState }],
    [UserAuthenticationProvider, { service: userAuthenticationService }],
    [I18nextProvider, { i18n }],
    [ThemeWrapperNext],
    [SystemContextProvider, { commandsManager, extensionManager, hotkeysManager, servicesManager }],
    [ViewportRefsProvider],
    [ViewportGridProvider, { service: viewportGridService }],
    [ViewportDialogProvider, { service: uiViewportDialogService }],
    [CineProvider, { service: cineService }],
    [NotificationProvider, { service: uiNotificationService }],
    [TooltipProvider],
    [DialogProvider, { service: uiDialogService, dialog: ManagedDialog }],
    [ModalProvider, { service: uiModalService, modal: ModalNext }],
    [ShepherdJourneyProvider],
  ];

  // Loop through and register each of the service providers registered with the ServiceProvidersManager.
  const providersFromManager = Object.entries(serviceProvidersManager.providers);
  if (providersFromManager.length > 0) {
    providersFromManager.forEach(([serviceName, provider]) => {
      providers.push([provider, { service: servicesManager.services[serviceName] }]);
    });
  }

  const CombinedProviders = ({ children }) => Compose({ components: providers, children });

  let authRoutes = null;

  // Should there be a generic call to init on the extension manager?
  customizationService.init(extensionManager);

  // Set up cookie-based authentication if OIDC is not configured
  // This will read the token from cookies and pass it in all API request headers
  const cookieAuth = appConfigState.cookieAuth;
  const shouldUseCookieAuth = cookieAuth && cookieAuth.enabled && (!oidc || oidc.length === 0);

  if (shouldUseCookieAuth) {
    const getAuthorizationHeader = () => {
      const appCfg =
        typeof window !== 'undefined'
          ? (
              window as unknown as {
                config?: { pacsIntegration?: string; azurePacsPreferCookieAuth?: boolean };
              }
            ).config
          : undefined;
      if (appCfg?.pacsIntegration === 'azurepacs' && !appCfg?.azurePacsPreferCookieAuth) {
        const azureToken =
          typeof window !== 'undefined'
            ? (window as unknown as { AZURE_PACS_TOKEN?: string }).AZURE_PACS_TOKEN
            : undefined;
        if (azureToken && typeof azureToken === 'string' && azureToken.trim()) {
          return {
            Authorization: `Bearer ${azureToken.trim()}`,
          };
        }
      }

      const viewerBearer =
        typeof window !== 'undefined' &&
        (window as unknown as { getViewerAccessBearerToken?: () => string | null })
          .getViewerAccessBearerToken &&
        typeof (window as unknown as { getViewerAccessBearerToken: () => string | null })
          .getViewerAccessBearerToken === 'function'
          ? (
              window as unknown as { getViewerAccessBearerToken: () => string | null }
            ).getViewerAccessBearerToken()
          : null;

      if (viewerBearer) {
        return {
          Authorization: `Bearer ${viewerBearer}`,
        };
      }

      return {};
    };

    const handleUnauthenticated = () => {
      if (typeof window === 'undefined') {
        return;
      }
      const appConfig = window.config || {};
      if (!isRedirectToRisOn401Enabled(appConfig)) {
        console.warn(
          'Authentication failed (401) - RIS redirect disabled (redirectToRisOn401: false).'
        );
        return;
      }
      const target = resolveRis401RedirectUrlFromConfig(appConfig);
      console.log('Authentication failed (401) - redirecting to RIS:', target);
      window.location.href = target;
    };

    userAuthenticationService.setServiceImplementation({
      getAuthorizationHeader,
      handleUnauthenticated,
    } as any);
  }

  // Use config to create routes
  const appRoutes = createRoutes({
    modes,
    dataSources,
    extensionManager,
    servicesManager,
    commandsManager,
    hotkeysManager,
    routerBasename,
    showStudyList,
    appConfig: appConfigState,
  });

  if (oidc) {
    authRoutes = (
      <OpenIdConnectRoutes
        oidc={oidc}
        routerBasename={routerBasename}
        userAuthenticationService={userAuthenticationService}
      />
    );
  }

  return (
    <CombinedProviders>
      <BrowserRouter
        basename={routerBasename}
        future={routerFutureFlags}
      >
        <RisPostMessageBridge />
        {authRoutes}
        {appRoutes}
      </BrowserRouter>
    </CombinedProviders>
  );
}

App.propTypes = {
  config: PropTypes.oneOfType([PropTypes.object, PropTypes.func]).isRequired,
  /* Extensions that are "bundled" or "baked-in" to the application.
   * These would be provided at build time as part of they entry point. */
  defaultExtensions: PropTypes.array,
  /* Modes that are "bundled" or "baked-in" to the application.
   * These would be provided at build time as part of they entry point. */
  defaultModes: PropTypes.array,
};

export default App;

export { commandsManager, extensionManager, servicesManager };
