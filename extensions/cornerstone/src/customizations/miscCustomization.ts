import { CinePlayer } from '@ohif/ui-next';
import DicomUpload from '../components/DicomUpload/DicomUpload';
import StudyCineHeaderControls from '../components/CinePlayer/StudyCineHeaderControls';

export default {
  cinePlayer: CinePlayer,
  'ohif.viewerHeaderCineControls': StudyCineHeaderControls,
  /** Modalities that auto-enable the cine player (and thus allow autoplay). US only. */
  autoCineModalities: ['US'],
  /**
   * Default cine UI preferences (overridden by cookie userPreferences_cinePreferences).
   * - showFps / showFr: which rate controls doctors see
   * - autoPlay: play multiframe US stacks when they load
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
