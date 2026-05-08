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
    const shouldSuppressIsAttributeUsedError = (value: unknown) => {
      const text = String(value ?? '');
      return text.includes('isAttributeUsed');
    };

    const onWindowError = (event: ErrorEvent) => {
      const message = event?.message ?? '';
      const stack = event?.error?.stack ?? '';
      if (shouldSuppressIsAttributeUsedError(message) || shouldSuppressIsAttributeUsedError(stack)) {
        event.preventDefault();
        // Some runtime overlays subscribe before our handler; stop propagation too.
        event.stopImmediatePropagation?.();
      }
    };

    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      const reason = event?.reason as any;
      const reasonMessage = reason?.message ?? reason?.toString?.() ?? '';
      const reasonStack = reason?.stack ?? '';
      if (
        shouldSuppressIsAttributeUsedError(reasonMessage) ||
        shouldSuppressIsAttributeUsedError(reasonStack)
      ) {
        event.preventDefault();
        event.stopImmediatePropagation?.();
      }
    };

    const previousOnError = window.onerror;
    window.onerror = function (message, source, lineno, colno, error) {
      const msg = typeof message === 'string' ? message : String(message ?? '');
      const stack = (error as any)?.stack ?? '';
      if (shouldSuppressIsAttributeUsedError(msg) || shouldSuppressIsAttributeUsedError(stack)) {
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
        if (shouldSuppressIsAttributeUsedError(msg) || shouldSuppressIsAttributeUsedError(stack)) {
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
    return null;
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
      // /external/viewer: fixed Basic auth for PACS (no cookie token)
      const externalViewerBasic =
        typeof window !== 'undefined' &&
        (window as unknown as { getExternalViewerBasicToken?: () => string | null }).getExternalViewerBasicToken &&
        typeof (window as unknown as { getExternalViewerBasicToken: () => string | null }).getExternalViewerBasicToken ===
          'function'
          ? (window as unknown as { getExternalViewerBasicToken: () => string | null }).getExternalViewerBasicToken()
          : null;
      if (externalViewerBasic) {
        return {
          Authorization: `Basic ${externalViewerBasic}`,
        };
      }

      const appCfg = typeof window !== 'undefined'
        ? (window as unknown as {
            config?: { pacsIntegration?: string; azurePacsPreferCookieAuth?: boolean };
          }).config
        : undefined;
      if (
        appCfg?.pacsIntegration === 'azurepacs' &&
        !appCfg?.azurePacsPreferCookieAuth
      ) {
        // @ts-ignore - set in config/default.js when pacsIntegration is azurepacs
        const azureToken = typeof window !== 'undefined' && window.AZURE_PACS_TOKEN;
        const azurePlaceholder = 'YOUR_AZURE_DICOM_TOKEN_HERE';
        if (azureToken && typeof azureToken === 'string' && azureToken !== azurePlaceholder) {
          return {
            Authorization: `Bearer ${azureToken}`,
          };
        }
      }

      // Check if we're on a demo route and use demo token
      // @ts-ignore - Accessing custom property on window
      const isDemo = window.isDemoRoute && typeof window.isDemoRoute === 'function' ? window.isDemoRoute() : false;
      // @ts-ignore - Accessing custom property on window
      const demoToken = window.getDemoToken && typeof window.getDemoToken === 'function' ? window.getDemoToken() : null;

      if (isDemo && demoToken) {
        // Use Basic auth for demo token
        return {
          Authorization: `Basic ${demoToken}`,
        };
      }

      // Share link (ShortCode): when URL has ShortCode and it is not expired, use basic token for PACS
      // @ts-ignore - Share link helpers from app config
      const isShareLink = window.isShareLinkMode && typeof window.isShareLinkMode === 'function' ? window.isShareLinkMode() : false;
      // @ts-ignore
      const shareLinkToken = window.getShareLinkBasicToken && typeof window.getShareLinkBasicToken === 'function' ? window.getShareLinkBasicToken() : null;
      if (isShareLink && shareLinkToken) {
        return {
          Authorization: `Basic ${shareLinkToken}`,
        };
      }

      // Get token from cookie - use configured cookie name, then patientToken (for patient-facing app), then common names
      // Either token or patientToken is passed by the parent application; both are sent to PACS API (study, series, instance)
      const cookieName = cookieAuth.cookieName || 'token';
      const patientTokenCookieName = cookieAuth.patientTokenCookieName || 'patientToken';
      let token = getCookie(cookieName) || getCookie(patientTokenCookieName);

      // Fallback to common cookie names if configured names not found
      if (!token) {
        token = getCookie('token') || getCookie('patientToken') || getCookie('accessToken') || getCookie('authToken') || getCookie('jwt');
      }

      if (token) {
        return {
          Authorization: `Bearer ${token}`,
        };
      }

      // Return empty object if no token found
      return {};
    };

    const handleUnauthenticated = () => {
      if (typeof window === 'undefined') {
        return;
      }
      const appConfig = window.config || {};
      if (!isRedirectToRisOn401Enabled(appConfig)) {
        console.warn('Authentication failed (401) - RIS redirect disabled (redirectToRisOn401: false).');
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
  config: PropTypes.oneOfType([
    PropTypes.object,
    PropTypes.func,
  ]).isRequired,
  /* Extensions that are "bundled" or "baked-in" to the application.
   * These would be provided at build time as part of they entry point. */
  defaultExtensions: PropTypes.array,
  /* Modes that are "bundled" or "baked-in" to the application.
   * These would be provided at build time as part of they entry point. */
  defaultModes: PropTypes.array,
};

export default App;

export { commandsManager, extensionManager, servicesManager };
