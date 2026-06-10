import { CinePlayer } from '@ohif/ui-next';
import DicomUpload from '../components/DicomUpload/DicomUpload';
import StudyCineHeaderControls from '../components/CinePlayer/StudyCineHeaderControls';

export default {
  cinePlayer: CinePlayer,
  'ohif.viewerHeaderCineControls': StudyCineHeaderControls,
  autoCineModalities: ['OT', 'US', 'PT'],
  'panelMeasurement.disableEditing': false,
  onBeforeSRAddMeasurement: ({ measurement, StudyInstanceUID, SeriesInstanceUID }) => {
    return measurement;
  },
  onBeforeDicomStore: ({ dicomDict, measurementData, naturalizedReport }) => {
    return dicomDict;
  },
  dicomUploadComponent: DicomUpload,
  codingValues: {},
};
