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

// US-only display set selector for multi-series ultrasound layouts
const usDisplaySetSelector = {
  allowUnmatchedView: true,
  seriesMatchingRules: [
    {
      weight: 100,
      attribute: 'Modality',
      constraint: {
        equals: 'US',
      },
    },
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
      id: 'FourOrMoreSeries',
      weight: 200,
      attribute: 'numberOfDisplaySetsWithImages',
      constraint: {
        greaterThan: { value: 3 },
      },
    },
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

const currentStudyDisplaySetSelector = {
  studyMatchingRules: [
    {
      attribute: 'studyInstanceUIDsIndex',
      from: 'options',
      required: true,
      constraint: {
        equals: { value: 0 },
      },
    },
  ],
  seriesMatchingRules: allModalityDisplaySetSelector.seriesMatchingRules,
};

const priorStudyDisplaySetSelector = {
  studyMatchingRules: [
    {
      attribute: 'studyInstanceUIDsIndex',
      from: 'options',
      required: true,
      constraint: {
        equals: { value: 1 },
      },
    },
  ],
  seriesMatchingRules: allModalityDisplaySetSelector.seriesMatchingRules,
};

/**
 * Cross-sectional comparison layout: current study on top, prior/comparison study on bottom.
 * Preferred over side-by-side (1×3 / 1×2 horizontal) when a prior study is available.
 */
const allModalityCompare2x1Protocol: Types.HangingProtocol.Protocol = {
  id: 'allModalityCompare2x1',
  name: 'ALL | Compare 2×1',
  description: 'Current study on top, comparison study on bottom (cross-sectional)',
  numberOfPriorsReferenced: 1,
  protocolMatchingRules: [
    {
      id: 'HasPriorStudy',
      weight: 1000,
      attribute: 'StudyInstanceUID',
      from: 'prior',
      required: true,
      constraint: {
        notNull: true,
      },
    },
    {
      id: 'CrossSectionalModality',
      weight: 500,
      attribute: 'ModalitiesInStudy',
      constraint: {
        contains: ['CT', 'MR'],
      },
    },
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
    currentStudyDisplaySet: currentStudyDisplaySetSelector,
    priorStudyDisplaySet: priorStudyDisplaySetSelector,
  },
  defaultViewport,
  stages: [
    {
      id: 'compare2x1',
      name: 'Compare 2×1',
      stageActivation: {
        enabled: {
          minViewportsMatched: 2,
        },
      },
      viewportStructure: {
        layoutType: 'grid',
        properties: {
          rows: 2,
          columns: 1,
        },
      },
      viewports: [
        {
          viewportOptions,
          displaySets: [
            {
              id: 'currentStudyDisplaySet',
            },
          ],
        },
        {
          viewportOptions,
          displaySets: [
            {
              id: 'priorStudyDisplaySet',
            },
          ],
        },
      ],
    },
  ],
};

/**
 * Ultrasound-only 2×2 layout (up to 4 instances side by side).
 * Other modalities fall through to ALL | 1×1.
 */
const usModality1x4Protocol: Types.HangingProtocol.Protocol = {
  id: 'usModality1x4',
  name: 'US | 1×4',
  description: 'Ultrasound 2×2 grid for multiframe cine comparison',
  protocolMatchingRules: [
    {
      id: 'UltrasoundModality',
      weight: 1000,
      attribute: 'ModalitiesInStudy',
      constraint: {
        contains: ['US'],
      },
    },
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
    usDisplaySet: usDisplaySetSelector,
  },
  defaultViewport: {
    viewportOptions: {
      viewportType: 'stack',
      toolGroupId: 'default',
      allowUnmatchedView: true,
    },
    displaySets: [
      {
        id: 'usDisplaySet',
        matchedDisplaySetsIndex: -1,
      },
    ],
  },
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
          displaySets: [{ id: 'usDisplaySet' }],
        },
        {
          viewportOptions,
          displaySets: [{ id: 'usDisplaySet', matchedDisplaySetsIndex: 1 }],
        },
        {
          viewportOptions,
          displaySets: [{ id: 'usDisplaySet', matchedDisplaySetsIndex: 2 }],
        },
        {
          viewportOptions,
          displaySets: [{ id: 'usDisplaySet', matchedDisplaySetsIndex: 3 }],
        },
      ],
    },
  ],
  numberOfPriorsReferenced: -1,
};

export {
  allModality1x1Protocol,
  allModality1x2Protocol,
  allModality1x4Protocol,
  allModalityCompare2x1Protocol,
  usModality1x4Protocol,
};
