import React, { useState, useEffect } from 'react';
import { useSystem, hotkeys as hotkeysModule } from '@ohif/core';
import { UserPreferencesModal, FooterAction } from '@ohif/ui-next';
import { useTranslation } from 'react-i18next';
import i18n from '@ohif/i18n';

import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@ohif/ui-next';

const { availableLanguages, defaultLanguage, currentLanguage: currentLanguageFn } = i18n;

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

  const [state, setState] = useState({
    hotkeyDefinitions: hotkeyDefinitions as HotkeyDefinitions,
    languageValue: currentLanguage.value,
  });

  // Sync with current hotkeys when modal opens (e.g. from cookies/API), so Zoom In shows "*" not "+"
  useEffect(() => {
    const defs = (hotkeysManager.hotkeyDefinitions || {}) as HotkeyDefinitions;
    const zoomInEntry = Object.entries(defs).find(([, d]) => d?.label === 'Zoom In');
    console.log('[UserPreferencesModal] Syncing hotkeyDefinitions. Zoom In entry:', zoomInEntry?.[0], 'keys=', zoomInEntry?.[1]?.keys, 'total defs=', Object.keys(defs).length);
    setState(s => ({
      ...s,
      hotkeyDefinitions: defs,
    }));
  }, [hotkeysManager]);

  const onLanguageChangeHandler = (value: string) => {
    setState(state => ({ ...state, languageValue: value }));
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
    setState(state => ({
      ...state,
      languageValue: defaultLanguage.value,
      hotkeyDefinitions: hotkeyDefaults as HotkeyDefinitions,
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
