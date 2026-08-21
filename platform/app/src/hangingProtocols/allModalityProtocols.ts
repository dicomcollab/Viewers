import { Types } from '@ohif/core';

const viewportOptions = {
  toolGroupId: 'default',
  allowUnmatchedView: true,
  syncGroups: [
    {
      type: 'hydrateseg',
      id: 'sameFORId',
      source: true,
      target: true,
      options: {
        matchingRules: ['sameFOR'],
      },
    },
  ],
};

const allModalityDisplaySetSelector = {
  allowUnmatchedView: true,
  seriesMatchingRules: [
    {
      weight: 10,
      attribute: 'numImageFrames',
      constraint: {
        greaterThan: { value: 0 },
      },
    },
    {
      attribute: 'isDisplaySetFromUrl',
      weight: 20,
      constraint: {
        equals: true,
      },
    },
  ],
};

const defaultViewport = {
  viewportOptions: {
    viewportType: 'stack',
    toolGroupId: 'default',
    allowUnmatchedView: true,
  },
  displaySets: [
    {
      id: 'allModalityDisplaySet',
      matchedDisplaySetsIndex: -1,
    },
  ],
};

function createAllModalityGridProtocol({
  id,
  name,
  description,
  stageId,
  rows,
  columns,
  extraMatchingRules = [],
}: {
  id: string;
  name: string;
  description: string;
  stageId: string;
  rows: number;
  columns: number;
  extraMatchingRules?: Types.HangingProtocol.Protocol['protocolMatchingRules'];
}): Types.HangingProtocol.Protocol {
  const viewports = Array.from({ length: rows * columns }, (_, index) => ({
    viewportOptions,
    displaySets: [
      {
        id: 'allModalityDisplaySet',
        ...(index > 0 ? { matchedDisplaySetsIndex: index } : {}),
      },
    ],
  }));

  return {
    id,
    name,
    description,
    protocolMatchingRules: [
      ...extraMatchingRules,
      {
        id: 'OneOrMoreSeries',
        weight: 25,
        attribute: 'numberOfDisplaySetsWithImages',
        constraint: {
          greaterThan: 0,
        },
      },
    ],
    toolGroupIds: ['default'],
    displaySetSelectors: {
      allModalityDisplaySet: allModalityDisplaySetSelector,
    },
    defaultViewport,
    stages: [
      {
        id: stageId,
        name,
        stageActivation: {
          enabled: {
            minViewportsMatched: 1,
          },
        },
        viewportStructure: {
          layoutType: 'grid',
          properties: {
            rows,
            columns,
          },
        },
        viewports,
      },
    ],
    numberOfPriorsReferenced: -1,
  };
}

const allModality1x1Protocol = createAllModalityGridProtocol({
  id: 'allModality1x1',
  name: '1×1',
  description: '1×1 grid — default for all modalities (CT/MR/etc and single-series US)',
  stageId: '1x1',
  rows: 1,
  columns: 1,
  extraMatchingRules: [
    {
      // Prefer 1×1 for SR-only studies (no image series to hang).
      id: 'SrOnlyStudy',
      weight: 5000,
      attribute: 'isSrOnlyStudy',
      constraint: {
        equals: true,
      },
    },
  ],
});

const allModality1x2Protocol = createAllModalityGridProtocol({
  id: 'allModality1x2',
  name: '1×2',
  description: '1×2 grid — default for ultrasound with two image series',
  stageId: '1x2',
  rows: 1,
  columns: 2,
  extraMatchingRules: [
    {
      id: 'UltrasoundModality',
      weight: 1000,
      required: true,
      attribute: 'ModalitiesInStudy',
      constraint: {
        contains: ['US'],
      },
    },
    {
      // Count image series only so a single US instance plus SR reports
      // still hangs 1×1 (Frame Distribution is an explicit HP option).
      id: 'TwoOrMoreImageDisplaySets',
      weight: 200,
      required: true,
      attribute: 'numberOfDisplaySetsWithImages',
      constraint: {
        greaterThan: { value: 1 },
      },
    },
  ],
});

const allModality2x2Protocol = createAllModalityGridProtocol({
  id: 'allModality2x2',
  name: '2×2',
  description: '2×2 grid — default for ultrasound with three or more image series',
  stageId: '2x2',
  rows: 2,
  columns: 2,
  extraMatchingRules: [
    {
      id: 'UltrasoundModality',
      weight: 1000,
      required: true,
      attribute: 'ModalitiesInStudy',
      constraint: {
        contains: ['US'],
      },
    },
    {
      id: 'ThreeOrMoreImageDisplaySets',
      weight: 300,
      required: true,
      attribute: 'numberOfDisplaySetsWithImages',
      constraint: {
        greaterThan: { value: 2 },
      },
    },
  ],
});

const allModality2x4Protocol = createAllModalityGridProtocol({
  id: 'allModality2x4',
  name: '2×4',
  description: '2×4 grid (manual selection; not auto for any modality)',
  stageId: '2x4',
  rows: 2,
  columns: 4,
});

export {
  allModality1x1Protocol,
  allModality1x2Protocol,
  allModality2x2Protocol,
  allModality2x4Protocol,
};
