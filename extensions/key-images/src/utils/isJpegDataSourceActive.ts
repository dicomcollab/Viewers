type ExtensionManagerLike = {
  activeDataSourceName?: string;
  getActiveDataSourceDefinition?: () => { sourceName?: string };
  getActiveDataSource?: () => Array<{ name?: string; sourceName?: string }>;
};

const JPEG_DATA_SOURCE = 'localviewer-image-jpeg';

function normalizeDataSourceName(value?: string | null): string {
  return (value || '').toLowerCase();
}

function getConfiguredDefaultDataSourceName(): string {
  if (typeof window === 'undefined') {
    return '';
  }

  return normalizeDataSourceName(
    (window as Window & { config?: { defaultDataSourceName?: string } }).config
      ?.defaultDataSourceName
  );
}

export function isJpegDataSourceActive(extensionManager?: ExtensionManagerLike): boolean {
  const activeDataSourceName = normalizeDataSourceName(
    extensionManager?.activeDataSourceName ||
      extensionManager?.getActiveDataSourceDefinition?.()?.sourceName
  );

  if (activeDataSourceName === JPEG_DATA_SOURCE) {
    return true;
  }

  if (typeof window === 'undefined') {
    return false;
  }

  const path = window.location?.pathname ?? '';
  const dataSourceQuery = normalizeDataSourceName(
    new URLSearchParams(window.location?.search || '').get('datasources')
  );

  if (path.includes(`/${JPEG_DATA_SOURCE}`) || dataSourceQuery === JPEG_DATA_SOURCE) {
    return true;
  }

  // /viewer without a datasource segment uses defaultDataSourceName from config.
  const hasExplicitDataSourceInPath = /\/localviewer-|\/dicomweb(?:\/|$)/i.test(path);
  if (!hasExplicitDataSourceInPath && getConfiguredDefaultDataSourceName() === JPEG_DATA_SOURCE) {
    return true;
  }

  return false;
}
