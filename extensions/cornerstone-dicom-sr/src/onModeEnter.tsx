import { SOPClassHandlerId, SOPClassHandlerId3D } from './id';
import { getRisAuthTokenFromBrowserCookies, resolveRisApiBaseFromConfig } from '@ohif/core';
import formatContentItemValue from './utils/formatContentItem';

type StructuredReportNode = {
  ValueType?: string;
  ContentSequence?: StructuredReportNode[];
  ConceptNameCodeSequence?: { CodeMeaning?: string } | Array<{ CodeMeaning?: string }>;
};

type AutoSenderWindow = Window & {
  __srAutoSenderQueue?: Promise<void>;
  __srAutoSenderSent?: Set<string>;
  __srAutoSenderSubUnsubscribe?: () => void;
  config?: Record<string, any>;
};

function isSRDisplaySet(ds) {
  return ds?.SOPClassHandlerId === SOPClassHandlerId || ds?.SOPClassHandlerId === SOPClassHandlerId3D;
}

function toMeaningLabel(
  conceptNameCodeSequence?: { CodeMeaning?: string } | Array<{ CodeMeaning?: string }>
) {
  const concept = Array.isArray(conceptNameCodeSequence)
    ? conceptNameCodeSequence[0]
    : conceptNameCodeSequence;
  return concept?.CodeMeaning || '';
}

function collectStructuredReportLines(node: StructuredReportNode, prefix = ''): string[] {
  if (!node) {
    return [];
  }

  const label = toMeaningLabel(node.ConceptNameCodeSequence);
  const nextPrefix = label ? (prefix ? `${prefix} > ${label}` : label) : prefix;
  const lines: string[] = [];

  if (node.ValueType && node.ValueType !== 'CONTAINER') {
    const value = formatContentItemValue(node);
    if (value != null && String(value).trim()) {
      lines.push(nextPrefix ? `${nextPrefix}: ${value}` : String(value));
    }
  }

  const children = node.ContentSequence || [];
  for (const child of children) {
    lines.push(...collectStructuredReportLines(child, nextPrefix));
  }

  return lines;
}

async function sendSRDisplaySetTextToRis(ds) {
  const srInstance = ds?.instance || ds?.instances?.[ds.instances.length - 1];
  if (!srInstance) {
    return;
  }

  const risToken = getRisAuthTokenFromBrowserCookies();
  if (!risToken) {
    return;
  }

  const appConfig =
    typeof window !== 'undefined' ? (((window as AutoSenderWindow).config as Record<string, any>) ?? {}) : {};
  const risApiBase = resolveRisApiBaseFromConfig(appConfig);
  const endpointPath = appConfig.risSrTextUploadPath || '/api/v1/structured-report/send-text';
  const endpointUrl = `${risApiBase}${endpointPath.startsWith('/') ? endpointPath : `/${endpointPath}`}`;

  const reportText = collectStructuredReportLines(srInstance).join('\n').trim();
  if (!reportText) {
    return;
  }

  const response = await fetch(endpointUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Token: risToken,
    },
    body: JSON.stringify({
      studyInstanceUID: srInstance?.StudyInstanceUID || '',
      seriesInstanceUID: srInstance?.SeriesInstanceUID || '',
      sopInstanceUID: srInstance?.SOPInstanceUID || '',
      patientId: srInstance?.PatientID || '',
      reportText,
    }),
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
}

function queueAutoSend(ds) {
  if (typeof window === 'undefined' || !ds?.SOPInstanceUID) {
    return;
  }

  const w = window as AutoSenderWindow;
  if (!w.__srAutoSenderSent) {
    w.__srAutoSenderSent = new Set();
  }
  if (w.__srAutoSenderSent.has(ds.SOPInstanceUID)) {
    return;
  }
  w.__srAutoSenderSent.add(ds.SOPInstanceUID);

  const run = async () => {
    try {
      if (!ds?.isLoaded && typeof ds?.load === 'function') {
        await ds.load();
      }
      await sendSRDisplaySetTextToRis(ds);
    } catch (error) {
      console.warn('SR auto-send failed', ds?.SOPInstanceUID, error);
    }
  };

  w.__srAutoSenderQueue = (w.__srAutoSenderQueue || Promise.resolve()).then(run);
}

export default function onModeEnter({ servicesManager }) {
  const { displaySetService } = servicesManager.services;
  const displaySetCache = displaySetService.getDisplaySetCache();

  const srDisplaySets = [...displaySetCache.values()].filter(ds => isSRDisplaySet(ds));

  srDisplaySets.forEach(ds => {
    // New mode route, allow SRs to be hydrated again
    ds.isHydrated = false;
    queueAutoSend(ds);
  });

  if (typeof window !== 'undefined') {
    const w = window as AutoSenderWindow;
    w.__srAutoSenderSubUnsubscribe?.();
    const sub = displaySetService.subscribe(
      displaySetService.EVENTS.DISPLAY_SETS_ADDED,
      ({ displaySetsAdded }) => {
        displaySetsAdded?.forEach(ds => {
          if (isSRDisplaySet(ds)) {
            queueAutoSend(ds);
          }
        });
      }
    );
    w.__srAutoSenderSubUnsubscribe = () => sub?.unsubscribe?.();
  }
}
