import React, { useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import PropTypes from 'prop-types';
import { resolveRisRootRedirectUrlFromConfig } from '@ohif/core';

/**
 * Component that redirects root route (/) to RIS worklist if configured
 */
const RootRedirect = ({ risWorklistUrl: propRisWorklistUrl, redirectRootToRis: propRedirectRootToRis }) => {
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    // Get config from props or fallback to window.config
    const appConfig = window.config || {};
    const redirectRootToRis = propRedirectRootToRis !== undefined
      ? propRedirectRootToRis
      : appConfig.redirectRootToRis !== undefined
      ? appConfig.redirectRootToRis
      : true; // Default to true if not specified
    const risWorklistUrl =
      propRisWorklistUrl || resolveRisRootRedirectUrlFromConfig(appConfig);

    // Only redirect if we're on the root path and redirect is enabled
    const currentPath = location.pathname;
    const isRootPath = currentPath === '/' || currentPath === '';

    console.log('RootRedirect check:', {
      redirectRootToRis,
      risWorklistUrl,
      currentPath,
      isRootPath,
      propRedirectRootToRis,
      propRisWorklistUrl,
      appConfigRedirect: appConfig.redirectRootToRis,
      appConfigRisUrl: appConfig.risWorklistUrl,
    });

    // Redirect if enabled and we have a URL and we're on root path
    if (redirectRootToRis && risWorklistUrl && isRootPath) {
      console.log('Redirecting to RIS worklist:', risWorklistUrl);
      // Redirect to external RIS worklist URL immediately
      window.location.replace(risWorklistUrl);
    }
  }, [propRedirectRootToRis, propRisWorklistUrl, location.pathname]);

  // Return null while redirecting
  return null;
};

RootRedirect.propTypes = {
  risWorklistUrl: PropTypes.string,
  redirectRootToRis: PropTypes.bool,
};

export default RootRedirect;
