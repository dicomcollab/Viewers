// Updated ToolbarLayoutSelector.tsx
import React, { useCallback, useMemo } from 'react';
import PropTypes from 'prop-types';
import { CommandsManager } from '@ohif/core';

import { LayoutSelector } from '@ohif/ui-next';
import { useTranslation } from 'react-i18next';
import { saveHangingProtocolChoice } from '../utils/viewerLayoutPreferences';

function ToolbarLayoutSelectorWithServices({
  commandsManager,
  servicesManager,
  rows = 3,
  columns = 4,
  ...props
}) {
  const { customizationService, uiNotificationService } = servicesManager.services;
  const { t } = useTranslation('ToolbarLayoutSelector');
  const advancedVolumeProtocolIds = useMemo(
    () => new Set(['mpr', 'axial-primary', '3d-four-up', '3d-main', '3d-only', '3d-primary']),
    []
  );

  const isJpegDataSourceActive = useMemo(() => {
    if (typeof window === 'undefined') {
      return false;
    }

    const path = window.location?.pathname ?? '';
    const search = window.location?.search ?? '';
    const qp = new URLSearchParams(search);
    const dataSourceQuery = qp.get('datasources') ?? '';

    return (
      path.includes('/localviewer-image-jpeg') ||
      dataSourceQuery.toLowerCase() === 'localviewer-image-jpeg'
    );
  }, []);

  // Get the presets from the customization service
  const commonPresets = customizationService?.getCustomization('layoutSelector.commonPresets') || [
    {
      icon: 'layout-single',
      commandOptions: {
        numRows: 1,
        numCols: 1,
      },
    },
    {
      icon: 'layout-side-by-side',
      commandOptions: {
        numRows: 1,
        numCols: 2,
      },
    },
    {
      icon: 'layout-four-up',
      commandOptions: {
        numRows: 2,
        numCols: 2,
      },
    },
    {
      icon: 'layout-three-row',
      commandOptions: {
        numRows: 3,
        numCols: 1,
      },
    },
  ];

  // Get the advanced presets generator from the customization service
  const advancedPresetsGenerator = customizationService?.getCustomization(
    'layoutSelector.advancedPresetGenerator'
  );

  // Generate the advanced presets
  const advancedPresets = advancedPresetsGenerator
    ? advancedPresetsGenerator({ servicesManager })
    : [
        {
          title: 'MPR',
          icon: 'layout-three-col',
          commandOptions: {
            protocolId: 'mpr',
          },
        },
        {
          title: '3D four up',
          icon: 'layout-four-up',
          commandOptions: {
            protocolId: '3d-four-up',
          },
        },
        {
          title: '3D main',
          icon: 'layout-three-row',
          commandOptions: {
            protocolId: '3d-main',
          },
        },
        {
          title: 'Axial Primary',
          icon: 'layout-side-by-side',
          commandOptions: {
            protocolId: 'axial-primary',
          },
        },
        {
          title: '3D only',
          icon: 'layout-single',
          commandOptions: {
            protocolId: '3d-only',
          },
        },
        {
          title: '3D primary',
          icon: 'layout-side-by-side',
          commandOptions: {
            protocolId: '3d-primary',
          },
        },
        {
          title: 'Frame View',
          icon: 'icon-stack',
          commandOptions: {
            protocolId: 'frame-view',
          },
        },
      ];

  const advancedPresetsWithDataSourceGuard = useMemo(() => {
    if (!isJpegDataSourceActive) {
      return advancedPresets;
    }

    return advancedPresets.map(preset => {
      const protocolId = preset?.commandOptions?.protocolId;
      if (!protocolId || !advancedVolumeProtocolIds.has(protocolId)) {
        return preset;
      }

      return {
        ...preset,
        disabled: true,
      };
    });
  }, [advancedPresets, advancedVolumeProtocolIds, isJpegDataSourceActive]);

  // Unified selection handler that dispatches to the appropriate command
  const handleSelectionChange = useCallback(
    (commandOptions, isPreset) => {
      if (isPreset) {
        const protocolId = commandOptions?.protocolId;
        if (
          isJpegDataSourceActive &&
          typeof protocolId === 'string' &&
          advancedVolumeProtocolIds.has(protocolId)
        ) {
          uiNotificationService?.show?.({
            title: 'Layout not supported for JPEG source',
            message:
              'MPR/3D layouts require volumetric pixel data. Use octet-stream/application-dicom datasource for these layouts.',
            type: 'warning',
            duration: 5000,
          });
          return;
        }
        // Advanced preset selection
        commandsManager.run({
          commandName: 'setHangingProtocol',
          commandOptions,
        });
        if (typeof protocolId === 'string' && protocolId) {
          saveHangingProtocolChoice(
            {
              kind: 'protocol',
              protocolId,
            },
            servicesManager
          );
        }
      } else {
        // Common preset or custom grid selection
        commandsManager.run({
          commandName: 'setViewportGridLayout',
          commandOptions,
        });
        if (commandOptions?.numRows && commandOptions?.numCols) {
          saveHangingProtocolChoice(
            {
              kind: 'grid',
              numRows: commandOptions.numRows,
              numCols: commandOptions.numCols,
            },
            servicesManager
          );
        }
      }
    },
    [
      commandsManager,
      isJpegDataSourceActive,
      advancedVolumeProtocolIds,
      uiNotificationService,
      servicesManager,
    ]
  );

  return (
    <div
      id="Layout"
      data-cy="Layout"
    >
      <LayoutSelector
        onSelectionChange={handleSelectionChange}
        {...props}
      >
        <LayoutSelector.Trigger tooltip={t('Change layout')} />
        <LayoutSelector.Content>
          {/* Left side - Presets */}
          {(commonPresets.length > 0 || advancedPresets.length > 0) && (
            <div className="bg-popover flex flex-col gap-2.5 rounded-lg p-2">
              {commonPresets.length > 0 && (
                <>
                  <LayoutSelector.PresetSection title={t('Common')}>
                    {commonPresets.map((preset, index) => (
                      <LayoutSelector.Preset
                        key={`common-preset-${index}`}
                        icon={preset.icon}
                        commandOptions={preset.commandOptions}
                        isPreset={false}
                      />
                    ))}
                  </LayoutSelector.PresetSection>
                  <LayoutSelector.Divider />
                </>
              )}

              {advancedPresetsWithDataSourceGuard.length > 0 && (
                <LayoutSelector.PresetSection title={t('Advanced')}>
                  {advancedPresetsWithDataSourceGuard.map((preset, index) => (
                    <LayoutSelector.Preset
                      key={`advanced-preset-${index}`}
                      title={preset.title}
                      icon={preset.icon}
                      commandOptions={preset.commandOptions}
                      disabled={preset.disabled}
                      isPreset={true}
                    />
                  ))}
                </LayoutSelector.PresetSection>
              )}
            </div>
          )}

          {/* Right Side - Grid Layout */}
          <div className="bg-muted flex flex-col gap-2.5 border-l-2 border-solid border-black p-2">
            <div className="text-muted-foreground text-xs">{t('Custom')}</div>
            <LayoutSelector.GridSelector
              rows={rows}
              columns={columns}
            />
            <LayoutSelector.HelpText>
              {t('Hover to select')} <br />
              {t('rows and columns')} <br />
              {t('Click to apply')}
            </LayoutSelector.HelpText>
          </div>
        </LayoutSelector.Content>
      </LayoutSelector>
    </div>
  );
}

ToolbarLayoutSelectorWithServices.propTypes = {
  commandsManager: PropTypes.instanceOf(CommandsManager),
  servicesManager: PropTypes.object,
  rows: PropTypes.number,
  columns: PropTypes.number,
};

export default ToolbarLayoutSelectorWithServices;
