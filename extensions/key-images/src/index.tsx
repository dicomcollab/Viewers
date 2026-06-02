import { id } from './id';
import getPanelModule from './getPanelModule';
import getCommandsModule from './getCommandsModule';
import getToolbarModule from './getToolbarModule';
import KeyImagesService from './services/KeyImagesService';

const keyImagesExtension = {
  id,
  preRegistration({ servicesManager }) {
    servicesManager.registerService(KeyImagesService.REGISTRATION);
  },
  getPanelModule,
  getCommandsModule,
  getToolbarModule,
};

export default keyImagesExtension;
