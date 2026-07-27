import { CinePlayer } from '@ohif/ui-next';
import DicomUpload from '../components/DicomUpload/DicomUpload';
import StudyCineHeaderControls from '../components/CinePlayer/StudyCineHeaderControls';

export default {
  cinePlayer: CinePlayer,
  'ohif.viewerHeaderCineControls': StudyCineHeaderControls,
  autoCineModalities: ['OT', 'US', 'PT'],
  /**
   * Default cine UI preferences (overridden by cookie userPreferences_cinePreferences).
   * - showFps / showFr: which rate controls doctors see
   * - autoPlay: play multiframe stacks when they load
   */
  cinePreferences: {
    showFps: false,
    showFr: true,
    autoPlay: true,
  },
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
