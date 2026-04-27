import PropTypes from 'prop-types';
import React from 'react';
import { CodeNameCodeSequenceValues } from '../enums';
import formatContentItemValue from '../utils/formatContentItem';
import { useSystem } from '@ohif/core/src/contextProviders/SystemProvider';
import { useViewportGrid } from '@ohif/ui-next';

const EMPTY_TAG_VALUE = '[empty]';

function OHIFCornerstoneSRContentItem(props) {
  const { contentItem, nodeIndexesTree, continuityOfContent } = props;
  const { servicesManager } = useSystem();
  const [{ activeViewportId }, viewportGridService] = useViewportGrid();
  const { displaySetService } = servicesManager.services;
  const conceptNameSequence = Array.isArray(contentItem?.ConceptNameCodeSequence)
    ? contentItem.ConceptNameCodeSequence[0]
    : contentItem?.ConceptNameCodeSequence;
  const { CodeValue, CodeMeaning } = conceptNameSequence ?? {};
  const isChildFirstNode = nodeIndexesTree[nodeIndexesTree.length - 1] === 0;
  const formattedValue = formatContentItemValue(contentItem) ?? EMPTY_TAG_VALUE;
  const startWithAlphaNumCharRegEx = /^[a-zA-Z0-9]/;
  const isContinuous = continuityOfContent === 'CONTINUOUS';
  const isFinding = CodeValue === CodeNameCodeSequenceValues.Finding;
  const isImageReference = contentItem?.ValueType === 'IMAGE';
  const contentLabel = CodeMeaning || contentItem?.ValueType || 'Content';
  const addExtraSpace =
    isContinuous && !isChildFirstNode && startWithAlphaNumCharRegEx.test(formattedValue?.[0]);

  const handleImageReferenceClick = event => {
    event.preventDefault();
    event.stopPropagation();

    const referencedSOPSequence = Array.isArray(contentItem?.ReferencedSOPSequence)
      ? contentItem.ReferencedSOPSequence[0]
      : contentItem?.ReferencedSOPSequence;
    const referencedSOPInstanceUID = referencedSOPSequence?.ReferencedSOPInstanceUID;
    const referencedFrameNumber = referencedSOPSequence?.ReferencedFrameNumber;

    if (!referencedSOPInstanceUID || !activeViewportId) {
      return;
    }

    const displaySets = displaySetService.getActiveDisplaySets();
    const referencedDisplaySet = displaySets.find(ds =>
      ds?.images?.some(image => image?.SOPInstanceUID === referencedSOPInstanceUID)
    );

    if (!referencedDisplaySet?.displaySetInstanceUID) {
      return;
    }

    const targetImageIndex = referencedDisplaySet.images.findIndex(image => {
      if (image?.SOPInstanceUID !== referencedSOPInstanceUID) {
        return false;
      }
      if (!referencedFrameNumber) {
        return true;
      }
      return Number(image?.frameNumber || 1) === Number(referencedFrameNumber);
    });

    viewportGridService.setDisplaySetsForViewport({
      viewportId: activeViewportId,
      displaySetInstanceUIDs: [referencedDisplaySet.displaySetInstanceUID],
      viewportOptions: {
        initialImageOptions: {
          index: targetImageIndex >= 0 ? targetImageIndex : 0,
        },
      },
    });
  };

  // Collapse sequences of white space preserving newline characters
  let className = 'whitespace-pre-line';

  if (CodeValue === CodeNameCodeSequenceValues.Finding) {
    // Preserve spaces because it is common to see tabular text in a
    // "Findings" ConceptNameCodeSequence
    className = 'whitespace-pre-wrap';
  }

  if (isContinuous) {
    return (
      <>
        <span
          className={className}
          title={contentLabel}
        >
          {addExtraSpace ? ' ' : ''}
          {formattedValue}
        </span>
      </>
    );
  }

  return (
    <>
      <div className="mb-2">
        <span className="font-bold">{contentLabel}: </span>
        {isFinding ? (
          <pre>{formattedValue}</pre>
        ) : isImageReference ? (
          <button
            type="button"
            className="text-primary-light cursor-pointer underline"
            onClick={handleImageReferenceClick}
          >
            {formattedValue}
          </button>
        ) : (
          <span className={className}>{formattedValue}</span>
        )}
      </div>
    </>
  );
}

OHIFCornerstoneSRContentItem.propTypes = {
  contentItem: PropTypes.object,
  nodeIndexesTree: PropTypes.arrayOf(PropTypes.number),
  continuityOfContent: PropTypes.string,
};

export { OHIFCornerstoneSRContentItem };
