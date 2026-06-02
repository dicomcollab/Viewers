function getToolbarModule({ servicesManager }) {
  const { keyImagesService } = servicesManager.services;

  return [
    {
      name: 'evaluate.addKeyImage',
      evaluate: () => {
        if (keyImagesService.isAddingKeyImage()) {
          return {
            disabled: true,
            disabledText: 'Adding key image...',
          };
        }

        return {
          disabled: false,
        };
      },
    },
  ];
}

export default getToolbarModule;
