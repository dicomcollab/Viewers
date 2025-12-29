import { Types } from '@ohif/core';

// Define viewport options inline to avoid import path issues
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

// Common display set selector for all modalities
// Similar to default protocol, but works for all modalities
const allModalityDisplaySetSelector = {
  allowUnmatchedView: true,
  seriesMatchingRules: [
    // Try to match series with images by default, but not required
    // This allows the protocol to work with all modalities
    {
      weight: 10,
      attribute: 'numImageFrames',
      constraint: {
        greaterThan: { value: 0 },
      },
    },
    // This display set will select the specified items by preference
    // It has no affect if nothing is specified in the URL.
    {
      attribute: 'isDisplaySetFromUrl',
      weight: 20,
      constraint: {
        equals: true,
      },
    },
  ],
};

// Common default viewport
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

/**
 * Hanging protocol for all modalities with 1×1 layout
 * This protocol matches all modalities and displays them in a 1×1 grid
 */
const allModality1x1Protocol: Types.HangingProtocol.Protocol = {
  id: 'allModality1x1',
  name: 'ALL | 1×1',
  description: 'Hanging protocol for all modalities with 1×1 layout',
  protocolMatchingRules: [
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
      id: '1x1',
      name: '1×1 Grid',
      stageActivation: {
        enabled: {
          minViewportsMatched: 1,
        },
      },
      viewportStructure: {
        layoutType: 'grid',
        properties: {
          rows: 1,
          columns: 1,
        },
      },
      viewports: [
        {
          viewportOptions,
          displaySets: [
            {
              id: 'allModalityDisplaySet',
            },
          ],
        },
      ],
    },
  ],
  numberOfPriorsReferenced: -1,
};

/**
 * Hanging protocol for all modalities with 1×2 layout
 * This protocol matches all modalities and displays them in a 1×2 grid
 */
const allModality1x2Protocol: Types.HangingProtocol.Protocol = {
  id: 'allModality1x2',
  name: 'ALL | 1×2',
  description: 'Hanging protocol for all modalities with 1×2 layout',
  protocolMatchingRules: [
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
      id: '1x2',
      name: '1×2 Grid',
      stageActivation: {
        enabled: {
          minViewportsMatched: 1,
        },
      },
      viewportStructure: {
        layoutType: 'grid',
        properties: {
          rows: 1,
          columns: 2,
        },
      },
      viewports: [
        {
          viewportOptions,
          displaySets: [
            {
              id: 'allModalityDisplaySet',
            },
          ],
        },
        {
          viewportOptions,
          displaySets: [
            {
              id: 'allModalityDisplaySet',
              matchedDisplaySetsIndex: 1,
            },
          ],
        },
      ],
    },
  ],
  numberOfPriorsReferenced: -1,
};

/**
 * Hanging protocol for all modalities with 2×2 layout (2 rows, 2 columns)
 * This protocol matches all modalities and displays them in a 2×2 grid
 */
const allModality1x4Protocol: Types.HangingProtocol.Protocol = {
  id: 'allModality1x4',
  name: 'ALL | 1×4',
  description: 'Hanging protocol for all modalities with 2×2 grid layout',
  protocolMatchingRules: [
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
      id: '1x4',
      name: '2×2 Grid',
      stageActivation: {
        enabled: {
          minViewportsMatched: 1,
        },
      },
      viewportStructure: {
        layoutType: 'grid',
        properties: {
          rows: 2,
          columns: 2,
        },
      },
      viewports: [
        {
          viewportOptions,
          displaySets: [
            {
              id: 'allModalityDisplaySet',
            },
          ],
        },
        {
          viewportOptions,
          displaySets: [
            {
              id: 'allModalityDisplaySet',
              matchedDisplaySetsIndex: 1,
            },
          ],
        },
        {
          viewportOptions,
          displaySets: [
            {
              id: 'allModalityDisplaySet',
              matchedDisplaySetsIndex: 2,
            },
          ],
        },
        {
          viewportOptions,
          displaySets: [
            {
              id: 'allModalityDisplaySet',
              matchedDisplaySetsIndex: 3,
            },
          ],
        },
      ],
    },
  ],
  numberOfPriorsReferenced: -1,
};

export { allModality1x1Protocol, allModality1x2Protocol, allModality1x4Protocol };
