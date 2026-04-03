import React from 'react';
import PanelKeyImages from './components/PanelKeyImages';

function getPanelModule({ servicesManager, commandsManager }) {
  return [
    {
      name: 'keyImages',
      iconName: 'tool-capture',
      iconLabel: 'Key Images',
      label: 'Key Images',
      component: () => (
        <PanelKeyImages
          servicesManager={servicesManager}
          commandsManager={commandsManager}
        />
      ),
    },
  ];
}

export default getPanelModule;
