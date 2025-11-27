/**
 * Type declaration for global QueryClient access
 */
declare global {
  interface Window {
    __OHIF_QUERY_CLIENT__?: import('@tanstack/react-query').QueryClient;
  }
}

export {};
