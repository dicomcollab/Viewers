/**
 * Entry point for development and production PWA builds.
 */
import 'regenerator-runtime/runtime';
import { createRoot } from 'react-dom/client';
import App from './App';
import React from 'react';

/**
 * EXTENSIONS AND MODES
 * =================
 * pluginImports.js is dynamically generated from extension and mode
 * configuration at build time.
 *
 * pluginImports.js imports all of the modes and extensions and adds them
 * to the window for processing.
 */
import { modes as defaultModes, extensions as defaultExtensions } from './pluginImports';
import loadDynamicConfig from './loadDynamicConfig';
import IframePreviewShell from './IframePreviewShell';
export { history } from './utils/history';
export { preserveQueryParameters, preserveQueryStrings } from './utils/preserveQueryParameters';

const IFRAME_PREVIEW_EMBED_PARAM = 'iframePreviewEmbed';

const isEmbeddedInIframe = () => {
  try {
    return window.self !== window.top;
  } catch (e) {
    return true;
  }
};

const isIframePreviewEmbedChild = () => {
  try {
    return new URLSearchParams(window.location.search).get(IFRAME_PREVIEW_EMBED_PARAM) === '1';
  } catch (e) {
    return false;
  }
};

const buildIframePreviewSrc = () => {
  const url = new URL(window.location.href);
  url.searchParams.set(IFRAME_PREVIEW_EMBED_PARAM, '1');
  return url.toString();
};

const shouldRenderIframePreviewShell = config =>
  config.iframePreviewHalfScreen === true &&
  !isEmbeddedInIframe() &&
  !isIframePreviewEmbedChild();

loadDynamicConfig(window.config).then(config_json => {
  // Reset Dynamic config if defined
  if (config_json !== null) {
    window.config = config_json;
  }

  const config = window.config || {};
  const container = document.getElementById('root');
  const root = createRoot(container);

  if (shouldRenderIframePreviewShell(config)) {
    root.render(
      React.createElement(IframePreviewShell, { iframeSrc: buildIframePreviewSrc() })
    );
    return;
  }

  /**
   * Combine our appConfiguration with installed extensions and modes.
   * In the future appConfiguration may contain modes added at runtime.
   *  */
  const appProps = {
    config,
    defaultExtensions,
    defaultModes,
  };

  root.render(React.createElement(App, appProps));
});
