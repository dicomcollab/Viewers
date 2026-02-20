import React, { useState, useEffect } from 'react';
import { useSystem, hotkeys as hotkeysModule } from '@ohif/core';
import { UserPreferencesModal, FooterAction } from '@ohif/ui-next';
import { useTranslation } from 'react-i18next';
import i18n from '@ohif/i18n';

import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@ohif/ui-next';

const { availableLanguages, defaultLanguage, currentLanguage: currentLanguageFn } = i18n;

const DATA_SOURCE_STORAGE_KEY = 'defaultDataSourceName';

interface HotkeyDefinition {
  keys: string;
  label: string;
}

interface HotkeyDefinitions {
  [key: string]: HotkeyDefinition;
}

function UserPreferencesModalDefault({ hide }: { hide: () => void }) {
  const { hotkeysManager } = useSystem();
  const { t } = useTranslation('UserPreferencesModal');

  const { hotkeyDefinitions = {}, hotkeyDefaults = {} } = hotkeysManager;

  const currentLanguage = currentLanguageFn();

  const dataSourceOptions =
    (typeof window !== 'undefined' && (window as Window & { config?: { dataSourceOptionsForPreferences?: { value: string; label: string }[] } })?.config?.dataSourceOptionsForPreferences) ||
    [];
  const defaultDataSourceFromStorage =
    typeof localStorage !== 'undefined' ? localStorage.getItem(DATA_SOURCE_STORAGE_KEY) : null;
  const fallbackDataSource = dataSourceOptions.length ? dataSourceOptions[0].value : '';

  const [state, setState] = useState({
    hotkeyDefinitions: hotkeyDefinitions as HotkeyDefinitions,
    languageValue: currentLanguage.value,
    dataSourceValue: defaultDataSourceFromStorage || fallbackDataSource,
  });

  useEffect(() => {
    if (dataSourceOptions.length && !defaultDataSourceFromStorage && typeof window !== 'undefined' && window.fetchPreferences) {
      (window as Window & { fetchPreferences: () => Promise<{ dataSourceFormat?: string } | null> })
        .fetchPreferences()
        .then(prefs => {
          if (prefs?.dataSourceFormat) {
            setState(s => ({ ...s, dataSourceValue: prefs.dataSourceFormat }));
          }
        })
        .catch(() => {});
    }
  }, [dataSourceOptions.length, defaultDataSourceFromStorage]);

  const onLanguageChangeHandler = (value: string) => {
    setState(s => ({ ...s, languageValue: value }));
  };

  const onDataSourceChangeHandler = (value: string) => {
    setState(s => ({ ...s, dataSourceValue: value }));
  };

  const onHotkeyChangeHandler = (id: string, newKeys: string) => {
    setState(state => ({
      ...state,
      hotkeyDefinitions: {
        ...state.hotkeyDefinitions,
        [id]: {
          ...state.hotkeyDefinitions[id],
          keys: newKeys,
        },
      },
    }));
  };

  const onResetHandler = async () => {
    setState(s => ({
      ...s,
      languageValue: defaultLanguage.value,
      hotkeyDefinitions: hotkeyDefaults as HotkeyDefinitions,
      dataSourceValue: dataSourceOptions.length ? dataSourceOptions[0].value : s.dataSourceValue,
    }));

    await hotkeysManager.restoreDefaultBindings();
  };

  return (
    <UserPreferencesModal>
      <UserPreferencesModal.Body>
        {/* Language Section */}
        <div className="mb-3 flex items-center space-x-14">
          <UserPreferencesModal.SubHeading>{t('Language')}</UserPreferencesModal.SubHeading>
          <Select
            defaultValue={state.languageValue}
            onValueChange={onLanguageChangeHandler}
          >
            <SelectTrigger
              className="w-60"
              aria-label="Language"
            >
              <SelectValue placeholder={t('Select language')} />
            </SelectTrigger>
            <SelectContent>
              {availableLanguages.map(lang => (
                <SelectItem
                  key={lang.value}
                  value={lang.value}
                >
                  {lang.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Data Source (frame retrieval) - selectable so API uses the chosen Accept header */}
        {dataSourceOptions.length > 0 && (
          <div className="mb-3 flex items-center space-x-14">
            <UserPreferencesModal.SubHeading>{t('Data Source')}</UserPreferencesModal.SubHeading>
            <Select
              value={state.dataSourceValue || dataSourceOptions[0]?.value}
              onValueChange={onDataSourceChangeHandler}
            >
              <SelectTrigger
                className="w-[28rem] max-w-full"
                aria-label="Data Source"
              >
                <SelectValue placeholder={t('Select data source')} />
              </SelectTrigger>
              <SelectContent>
                {dataSourceOptions.map(opt => (
                  <SelectItem
                    key={opt.value}
                    value={opt.value}
                  >
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <UserPreferencesModal.SubHeading>{t('Hotkeys')}</UserPreferencesModal.SubHeading>
        <UserPreferencesModal.HotkeysGrid>
          {Object.entries(state.hotkeyDefinitions).map(([id, definition]) => (
            <UserPreferencesModal.Hotkey
              key={id}
              label={t(definition.label)}
              value={definition.keys}
              onChange={newKeys => onHotkeyChangeHandler(id, newKeys)}
              placeholder={definition.keys}
              hotkeys={hotkeysModule}
            />
          ))}
        </UserPreferencesModal.HotkeysGrid>
      </UserPreferencesModal.Body>
      <FooterAction>
        <FooterAction.Left>
          <FooterAction.Auxiliary onClick={onResetHandler}>
            {t('Reset to defaults')}
          </FooterAction.Auxiliary>
        </FooterAction.Left>
        <FooterAction.Right>
          <FooterAction.Secondary
            onClick={() => {
              hotkeysModule.stopRecord();
              hotkeysModule.unpause();
              hide();
            }}
          >
            {t('Cancel')}
          </FooterAction.Secondary>
          <FooterAction.Primary
            onClick={async () => {
              if (state.languageValue !== currentLanguage.value) {
                i18n.changeLanguage(state.languageValue);
              }
              if (state.dataSourceValue && typeof window !== 'undefined') {
                const win = window as Window & {
                  config?: { defaultDataSourceName?: string };
                  savePreferences?: (p: { dataSourceFormat?: string }) => Promise<{ ok: boolean }>;
                };
                localStorage.setItem(DATA_SOURCE_STORAGE_KEY, state.dataSourceValue);
                if (win.config) {
                  win.config.defaultDataSourceName = state.dataSourceValue;
                }
                if (win.savePreferences) {
                  await win.savePreferences({ dataSourceFormat: state.dataSourceValue });
                }
              }
              // Convert hotkeyDefinitions object to array format for setHotkeys
              // The state.hotkeyDefinitions has updated keys (as string), but we need full definition from hotkeysManager
              const hotkeysArray = Object.entries(state.hotkeyDefinitions).map(([id, definition]) => {
                // Get the full definition from hotkeysManager which has commandName and commandOptions
                const fullDefinition = hotkeysManager.hotkeyDefinitions[id];

                // Convert keys from string (UI format) to array (API format) if needed
                // The UI provides keys as string like "z" or "ctrl+z"
                let keys = definition.keys;
                if (typeof keys === 'string') {
                  // Convert string to array format for API
                  keys = keys.includes('+') ? keys.split('+') : [keys];
                } else if (!Array.isArray(keys)) {
                  keys = [keys];
                }

                if (fullDefinition) {
                  // Use the updated keys from state, but keep everything else from full definition
                  return {
                    commandName: fullDefinition.commandName,
                    commandOptions: fullDefinition.commandOptions || {},
                    label: fullDefinition.label || definition.label || '',
                    keys: keys, // Use updated keys from state (converted to array)
                    isEditable: fullDefinition.isEditable !== undefined ? fullDefinition.isEditable : true,
                  };
                }

                // Fallback: try to find in defaults
                const defaultDef = Array.isArray(hotkeysManager.hotkeyDefaults)
                  ? hotkeysManager.hotkeyDefaults.find(def => {
                      const hash = hotkeysManager.generateHash(def);
                      return hash === id;
                    })
                  : null;

                if (defaultDef) {
                  return {
                    commandName: defaultDef.commandName,
                    commandOptions: defaultDef.commandOptions || {},
                    label: defaultDef.label || definition.label || '',
                    keys: keys,
                    isEditable: defaultDef.isEditable !== undefined ? defaultDef.isEditable : true,
                  };
                }

                // Last resort: return minimal definition
                return {
                  commandName: '',
                  commandOptions: {},
                  label: definition.label || '',
                  keys: keys,
                  isEditable: true,
                };
              });

              await hotkeysManager.setHotkeys(hotkeysArray, 'hotkey-definitions', true);
              hotkeysModule.stopRecord();
              hotkeysModule.unpause();
              hide();
            }}
          >
            {t('Save')}
          </FooterAction.Primary>
        </FooterAction.Right>
      </FooterAction>
    </UserPreferencesModal>
  );
}

export default {
  'ohif.userPreferencesModal': UserPreferencesModalDefault,
};
