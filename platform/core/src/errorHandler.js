// These should be overridden by the implementation
const errorHandler = {
  getHTTPErrorHandler: () => null,
  _servicesManager: null,
  setServicesManager: (servicesManager) => {
    errorHandler._servicesManager = servicesManager;
    // Expose errorHandler globally for use in image loaders
    if (typeof window !== 'undefined') {
      window.__OHIF_ERROR_HANDLER__ = errorHandler;
    }
  },
};

export default errorHandler;
