import {
  isStructuredReportDisplaySet,
  presentDisplaySetAfterStructuredReport,
  presentStructuredReportInOneUp,
} from '../utils/openStructuredReportInViewport';

export default {
  customOnDropHandler: ({
    servicesManager,
    commandsManager,
    displaySetInstanceUID,
  }) => {
    const displaySet =
      servicesManager?.services?.displaySetService?.getDisplaySetByUID(displaySetInstanceUID);

    if (isStructuredReportDisplaySet(displaySet)) {
      presentStructuredReportInOneUp({
        displaySet,
        commandsManager,
        servicesManager,
      });
      return Promise.resolve({ handled: true });
    }

    if (
      presentDisplaySetAfterStructuredReport({
        displaySetInstanceUID,
        commandsManager,
        servicesManager,
      })
    ) {
      return Promise.resolve({ handled: true });
    }

    return Promise.resolve({ handled: false });
  },
};
