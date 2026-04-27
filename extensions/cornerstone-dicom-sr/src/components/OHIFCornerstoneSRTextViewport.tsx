import PropTypes from 'prop-types';
import React, { useEffect, useState } from 'react';
import { ExtensionManager } from '@ohif/core';
import { OHIFCornerstoneSRContainer } from './OHIFCornerstoneSRContainer';
import { utils } from '@ohif/core';

function OHIFCornerstoneSRTextViewport(props: withAppTypes) {
  const { displaySets } = props;
  const displaySet = displaySets[0];
  const [instance, setInstance] = useState(
    displaySet.instance || displaySet.instances[displaySet.instances.length - 1]
  );

  useEffect(() => {
    let cancelled = false;

    const loadStructuredReport = async () => {
      if (!displaySet?.load) {
        return;
      }

      const hasContentSequence = Boolean(displaySet.instance?.ContentSequence);
      if (!displaySet.isLoaded || !hasContentSequence) {
        await displaySet.load();
      }

      if (!cancelled) {
        setInstance(displaySet.instance || displaySet.instances[displaySet.instances.length - 1]);
      }
    };

    loadStructuredReport().catch(() => {
      if (!cancelled) {
        setInstance(displaySet.instance || displaySet.instances[displaySet.instances.length - 1]);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [displaySet]);

  if (!instance) {
    return null;
  }

  const {
    PatientName,
    PatientID,
    PatientBirthDate,
    PatientSex,
    SeriesDescription,
    SeriesNumber,
    Manufacturer,
    CompletionFlag,
    VerificationFlag,
    ContentDate,
    ContentTime,
  } = instance;

  const formattedPatientName =
    PatientName && typeof PatientName === 'object' ? utils.formatPN(PatientName) : PatientName;
  const formattedBirthDate = PatientBirthDate ? utils.formatDate(PatientBirthDate) : '';
  const formattedContentDate = ContentDate ? utils.formatDate(ContentDate) : '';
  const formattedContentTime = ContentTime ? utils.formatTime(ContentTime) : '';
  const patientLine = [formattedPatientName, PatientSex ? `(${PatientSex})` : '', formattedBirthDate, PatientID ? `#${PatientID}` : '']
    .filter(Boolean)
    .join(', ');
  const seriesLine = [SeriesDescription, SeriesNumber ? `(#${SeriesNumber})` : '']
    .filter(Boolean)
    .join(' ');
  const contentDateTimeLine = [formattedContentDate, formattedContentTime].filter(Boolean).join(' ');

  return (
    <div className="relative flex h-full w-full flex-col overflow-auto p-4 text-white">
      <div>
        <div className="mb-3 text-sm">
          {patientLine ? (
            <div>
              <span className="font-bold">Patient:</span> {patientLine}
            </div>
          ) : null}
          {seriesLine ? (
            <div>
              <span className="font-bold">Series:</span> {seriesLine}
            </div>
          ) : null}
          {Manufacturer ? (
            <div>
              <span className="font-bold">Manufacturer:</span> {Manufacturer}
            </div>
          ) : null}
          {CompletionFlag ? (
            <div>
              <span className="font-bold">Completion Flag:</span> {CompletionFlag}
            </div>
          ) : null}
          {VerificationFlag ? (
            <div>
              <span className="font-bold">Verification Flag:</span> {VerificationFlag}
            </div>
          ) : null}
          {contentDateTimeLine ? (
            <div>
              <span className="font-bold">Content Date/Time:</span> {contentDateTimeLine}
            </div>
          ) : null}
        </div>

        {/* The root level is always a container */}
        <OHIFCornerstoneSRContainer container={instance} />
      </div>
    </div>
  );
}

OHIFCornerstoneSRTextViewport.propTypes = {
  displaySets: PropTypes.arrayOf(PropTypes.object),
  viewportId: PropTypes.string.isRequired,
  dataSource: PropTypes.object,
  children: PropTypes.node,
  viewportLabel: PropTypes.string,
  viewportOptions: PropTypes.object,
  servicesManager: PropTypes.object.isRequired,
  extensionManager: PropTypes.instanceOf(ExtensionManager).isRequired,
};

export default OHIFCornerstoneSRTextViewport;
