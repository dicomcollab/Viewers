import objectHash from 'object-hash';
import { hotkeys as mouseTrapAPI } from '../utils';
import Hotkey from './Hotkey';
import migrateOldHotkeyDefinitions from '../utils/hotkeys/migrateHotkeys';
import pubSubServiceInterface from '../services/_shared/pubSubServiceInterface';

// Function to get token from cookie
function getTokenFromCookie() {
  const name = 'token=';
  const decodedCookie = decodeURIComponent(document.cookie);
  const cookies = decodedCookie.split(';');
  for (let cookie of cookies) {
    cookie = cookie.trim();
    if (cookie.indexOf(name) === 0) {
      return cookie.substring(name.length);
    }
  }
  return null;
}

// Function to get backend URL from environment or config
function getBackendUrl() {
  if (typeof process !== 'undefined' && process.env && process.env.REACT_APP_BACKEND_HOTKEY_URL) {
    return process.env.REACT_APP_BACKEND_HOTKEY_URL;
  } else if (
    typeof window !== 'undefined' &&
    (window as any).config &&
    (window as any).config.backendHotkeyUrl
  ) {
    return (window as any).config.backendHotkeyUrl;
  } else {
    // Fallback to default URL if environment variable is not available
    return 'https://med-pacs-dev-risapi-fgb0frguhuaqgrfs.eastus-01.azurewebsites.net/api/v1/preferences';
  }
}

/**
 *
 *
 * @typedef {Object} HotkeyDefinition
 * @property {String} commandName - Command to call
 * @property {Object} commandOptions - Command options
 * @property {String} label - Display name for hotkey
 * @property {String[]} keys - Keys to bind; Follows Mousetrap.js binding syntax
 */
export class HotkeysManager {
  private _servicesManager: AppTypes.ServicesManager;
  private _commandsManager: AppTypes.CommandsManager;
  private isEnabled: boolean = true;
  public hotkeyDefinitions: Record<string, any> = {};
  public hotkeyDefaults: any[] = [];

  public static EVENTS: Record<string, string> = {
    HOTKEY_PRESSED: 'event::hotkeysManager:hotkeyPressed',
  };
  public EVENTS: Record<string, string>;
  public listeners: Record<
    string,
    Array<{ id: string; callback: (data: unknown) => void }> | undefined
  > = {};
  public subscribe: (
    eventName: string,
    callback: (data: unknown) => void
  ) => { unsubscribe: () => void };
  public _broadcastEvent: (eventName: string, callbackProps: unknown) => void;
  public _unsubscribe: (eventName: string, listenerId: string) => void;
  public _isValidEvent: (eventName: string) => boolean;

  constructor(
    commandsManager: AppTypes.CommandsManager,
    servicesManager: AppTypes.ServicesManager
  ) {
    this._servicesManager = servicesManager;
    this._commandsManager = commandsManager;

    this.EVENTS = HotkeysManager.EVENTS;
    this.subscribe = pubSubServiceInterface.subscribe.bind(this);
    this._broadcastEvent = pubSubServiceInterface._broadcastEvent.bind(this);
    this._unsubscribe = pubSubServiceInterface._unsubscribe.bind(this);
    this._isValidEvent = pubSubServiceInterface._isValidEvent.bind(this);

    // Check for old hotkey definitions format and migrate if needed
    migrateOldHotkeyDefinitions({
      generateHash: this.generateHash,
    });
  }

  /**
   * Exposes Mousetrap.js's `.record` method, added by the record plugin.
   *
   * @param {*} event
   */
  record(event) {
    return mouseTrapAPI.record(event);
  }

  cancel() {
    mouseTrapAPI.stopRecord();
    mouseTrapAPI.unpause();
  }

  /**
   * Disables all hotkeys. Hotkeys added while disabled will not listen for
   * input.
   */
  disable() {
    this.isEnabled = false;
    mouseTrapAPI.pause();
  }

  /**
   * Enables all hotkeys.
   */
  enable() {
    this.isEnabled = true;
    mouseTrapAPI.unpause();
  }

  /**
   * Uses most recent
   *
   * @returns {Promise<void>}
   */
  async restoreDefaultBindings() {
    await this.setHotkeys(this.hotkeyDefaults, 'hotkey-definitions', true);
  }

  /**
   *
   */
  destroy() {
    this.hotkeyDefaults = [];
    this.hotkeyDefinitions = {};
    mouseTrapAPI.reset();
  }

  /**
   * Registers a list of hotkey definitions.
   *
   * @param {HotkeyDefinition[] | Object} [hotkeyDefinitions=[]] Contains hotkeys definitions
   * @param {string} [name='hotkey-definitions'] Name for localStorage key
   * @param {boolean} [saveToApi=true] Whether to save hotkeys to API
   * @param {boolean} [validateConflicts=true] Whether to validate for key conflicts before setting
   */
  async setHotkeys(
    hotkeyDefinitions: any[] | Record<string, any> = [],
    name = 'hotkey-definitions',
    saveToApi = true,
    validateConflicts = true
  ) {
    try {
      const definitions = this.getValidDefinitions(hotkeyDefinitions);

      // Validate for conflicts if requested
      if (validateConflicts) {
        const validation = this.validateHotkeyDefinitions(definitions);
        if (!validation.isValid) {
          const errorMessage = `Hotkey conflicts detected: ${validation.conflicts.map(c =>
            `Key "${c.keys}" used by multiple commands`
          ).join(', ')}`;

          console.error('HotkeysManager:', errorMessage);

          const { uiNotificationService } = this._servicesManager.services;
          if (uiNotificationService) {
            uiNotificationService.show({
              title: 'Hotkey Conflicts',
              message: errorMessage,
              type: 'error',
              duration: 5000,
            });
          }

          throw new Error(errorMessage);
        }
      }

      // Remove old localStorage entry
      localStorage.removeItem(name);

      // Save to API if enabled
      if (saveToApi) {
        await this.saveHotkeysToAPI(definitions);
      }

      // Save to localStorage as backup
      localStorage.setItem(name, JSON.stringify(definitions));

      // Register hotkeys
      definitions.forEach(definition => this.registerHotkeys(definition));
    } catch (error) {
      console.error('Error while setting hotkeys:', error);
      const { uiNotificationService } = this._servicesManager.services;
      if (uiNotificationService) {
        uiNotificationService.show({
          title: 'Hotkeys Manager',
          message: 'Error while setting hotkeys',
          type: 'error',
        });
      }
    }
  }

  generateHash(definition) {
    return objectHash({
      commandName: definition.commandName,
      commandOptions: definition.commandOptions || {},
    });
  }

  /**
   * Public method to check if a key combination is available for use
   * @param {string | string[]} keys - The key combination to check
   * @param {string} excludeCommandName - Optional command name to exclude from the check
   * @returns {boolean} True if the key combination is available, false if it's already in use
   */
  isKeyAvailable(keys: string | string[], excludeCommandName?: string): boolean {
    if (!keys || keys === '') {
      return false;
    }

    let excludeCommandHash: string | undefined;
    if (excludeCommandName) {
      // Find the command hash for the exclude command
      for (const [hash, hotkey] of Object.entries(this.hotkeyDefinitions)) {
        if (hotkey.commandName === excludeCommandName) {
          excludeCommandHash = hash;
          break;
        }
      }
    }

    const conflict = this.checkForKeyConflict(keys, excludeCommandHash);
    return conflict === null;
  }

  /**
   * Get information about what command is using a specific key combination
   * @param {string | string[]} keys - The key combination to check
   * @returns {Object|null} Information about the command using the keys, or null if not in use
   */
  getKeyUsage(keys: string | string[]): { commandName: string; label: string } | null {
    const conflict = this.checkForKeyConflict(keys);
    if (conflict) {
      return {
        commandName: conflict.commandName,
        label: conflict.label || conflict.commandName,
      };
    }
    return null;
  }

  /**
   * Validates all hotkey definitions for conflicts
   * @param {HotkeyDefinition[]} definitions - Array of hotkey definitions to validate
   * @returns {Object} Validation result with conflicts array and isValid boolean
   */
  validateHotkeyDefinitions(definitions: any[]): { isValid: boolean; conflicts: any[] } {
    const keyMap = new Map<string, any>();
    const conflicts: any[] = [];

    for (const definition of definitions) {
      if (!definition.keys || definition.keys === '') {
        continue;
      }

      const normalizedKeys = this.normalizeKeys(definition.keys);
      const existingDefinition = keyMap.get(normalizedKeys);

      if (existingDefinition) {
        conflicts.push({
          keys: definition.keys,
          conflictingCommands: [
            {
              commandName: existingDefinition.commandName,
              label: existingDefinition.label,
            },
            {
              commandName: definition.commandName,
              label: definition.label,
            },
          ],
        });
      } else {
        keyMap.set(normalizedKeys, definition);
      }
    }

    return {
      isValid: conflicts.length === 0,
      conflicts,
    };
  }

  /**
   * Set default hotkey bindings. These
   * values are used in `this.restoreDefaultBindings`.
   *
   * @param {HotkeyDefinition[] | Object} [hotkeyDefinitions=[]] Contains hotkeys definitions
   * @param {boolean} [loadFromApi=true] Whether to load hotkeys from API preferences
   */
  async setDefaultHotKeys(hotkeyDefinitions = [], loadFromApi = true) {
    const definitions = this.getValidDefinitions(hotkeyDefinitions);

    // Validate for conflicts before setting
    const validation = this.validateHotkeyDefinitions(definitions);
    if (!validation.isValid) {
      console.warn('HotkeysManager: Conflicts detected in default hotkey definitions:', validation.conflicts);

      const { uiNotificationService } = this._servicesManager.services;
      if (uiNotificationService) {
        const conflictMessages = validation.conflicts.map(conflict =>
          `Key "${conflict.keys}" is used by: ${conflict.conflictingCommands.map(cmd => cmd.label || cmd.commandName).join(', ')}`
        );

        uiNotificationService.show({
          title: 'Hotkey Conflicts Detected',
          message: `The following key conflicts were found:\n${conflictMessages.join('\n')}`,
          type: 'warning',
          duration: 8000,
        });
      }
    }

    this.hotkeyDefaults = definitions;

    let updatedDefinitions = definitions;

    // Try to load hotkeys from API preferences if enabled
    if (loadFromApi) {
      try {
        const apiHotkeys = await this.loadHotkeysFromAPI();
        if (apiHotkeys && apiHotkeys.length > 0) {
          // Merge API hotkeys with defaults, prioritizing API hotkeys
          const apiHotkeysMap = new Map();
          apiHotkeys.forEach(apiHotkey => {
            const commandHash = this.generateHash(apiHotkey);
            apiHotkeysMap.set(commandHash, apiHotkey);
          });

          // Update definitions with API hotkeys, fallback to defaults
          updatedDefinitions = definitions.map(definition => {
            const commandHash = this.generateHash(definition);
            const apiHotkey = apiHotkeysMap.get(commandHash);

            if (apiHotkey) {
              // Convert API keys (array) to string format for UI display and binding
              // API provides keys as array like ["z"] or ["ctrl", "z"], convert to string like "z" or "ctrl+z"
              let keys: string | string[];
              if (Array.isArray(apiHotkey.keys) && apiHotkey.keys.length > 0) {
                // Convert array to string format for display and binding
                keys = apiHotkey.keys.join('+');
              } else if (typeof apiHotkey.keys === 'string') {
                // If it's already a string, keep it as is
                keys = apiHotkey.keys;
              } else {
                // Fallback to definition keys
                keys = definition.keys;
              }

              // Use API hotkey if available
              return {
                ...definition,
                keys: keys,
                label: apiHotkey.label || definition.label,
                isEditable:
                  apiHotkey.isEditable !== undefined ? apiHotkey.isEditable : definition.isEditable,
              };
            }

            return definition;
          });
        }
      } catch (error) {
        console.warn('Failed to load hotkeys from API, using defaults:', error);
      }
    }

    // Get user preferred keys from localStorage as fallback
    const userPreferredKeys = JSON.parse(localStorage.getItem('user-preferred-keys') || '{}');

    // Update definitions with user preferred keys before setting
    updatedDefinitions = updatedDefinitions.map(definition => {
      const commandHash = this.generateHash(definition);
      // If user has a preferred key binding, use it
      if (userPreferredKeys[commandHash]) {
        return {
          ...definition,
          keys: userPreferredKeys[commandHash],
        };
      }

      return definition;
    });

    // Set hotkeys without saving to API (to avoid circular saves during initialization)
    await this.setHotkeys(updatedDefinitions, 'hotkey-definitions', false);
  }

  /**
   * Load hotkeys from API preferences.
   * Uses shared window.fetchPreferences when available so getPreferences is only called once for the app.
   * @returns {Promise<HotkeyDefinition[]>} Array of hotkey definitions from API
   */
  async loadHotkeysFromAPI(): Promise<Array<Record<string, any>>> {
    try {
      const win =
        typeof window !== 'undefined'
          ? (window as Window & {
              fetchPreferences?: () => Promise<{ hotkeys?: Array<Record<string, any>> } | null>;
            })
          : null;
      if (win?.fetchPreferences) {
        const data = await win.fetchPreferences();
        if (data && data.hotkeys && Array.isArray(data.hotkeys)) {
          return data.hotkeys;
        }
        return [];
      }

      const token = getTokenFromCookie();
      if (!token) {
        console.warn('No token found in cookie, skipping API hotkey load');
        return [];
      }

      const backendUrl = getBackendUrl();
      const response = await fetch(`${backendUrl}/getPreferences`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          Token: token,
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();

      if (data && data.hotkeys && Array.isArray(data.hotkeys)) {
        return data.hotkeys;
      }

      return [];
    } catch (error) {
      console.error('Error loading hotkeys from API:', error);
      return [];
    }
  }

  /**
   * Save hotkeys to API preferences
   * @param {HotkeyDefinition[]} definitions Array of hotkey definitions to save
   */
  async saveHotkeysToAPI(definitions: Array<Record<string, any>>): Promise<void> {
    try {
      const token = getTokenFromCookie();
      if (!token) {
        throw new Error('No authentication token found');
      }

      const backendUrl = getBackendUrl();

      // Prepare hotkeys data in the format expected by API
      const hotkeysData = definitions.map(def => {
        // Convert keys to array format for API
        let keysArray: string[];
        if (Array.isArray(def.keys)) {
          keysArray = def.keys;
        } else if (typeof def.keys === 'string') {
          // If keys is a string like "z" or "ctrl+z", convert to array
          keysArray = def.keys.includes('+') ? def.keys.split('+') : [def.keys];
        } else {
          keysArray = [];
        }

        return {
          commandName: def.commandName,
          commandOptions: def.commandOptions || {},
          label: def.label || '',
          keys: keysArray,
          isEditable: def.isEditable !== undefined ? def.isEditable : true,
        };
      });

      // Use dynamic import for axios to avoid bundling issues
      const axios = await import('axios');

      const response = await axios.default.post(
        `${backendUrl}/savePreferences`,
        { hotkeys: hotkeysData },
        { headers: { Token: token } }
      );

      console.log('Saved hotkeys to API:', response.data);
    } catch (error) {
      console.error('Error saving hotkeys to API:', error);
      throw error;
    }
  }

  /**
   * Take hotkey definitions that can be an array or object and make sure that it
   * returns an array of hotkeys
   *
   * @param {HotkeyDefinition[] | Object} [hotkeyDefinitions=[]] Contains hotkeys definitions
   */
  getValidDefinitions(hotkeyDefinitions) {
    const definitions = Array.isArray(hotkeyDefinitions)
      ? [...hotkeyDefinitions]
      : this._parseToArrayLike(hotkeyDefinitions);

    // make sure isEditable is true for all definitions if not provided
    definitions.forEach(definition => {
      if (definition.isEditable === undefined) {
        definition.isEditable = true;
      }
    });

    return definitions;
  }

  /**
   * Take hotkey definitions that can be an array and make sure that it
   * returns an object of hotkeys definitions
   *
   * @param {HotkeyDefinition[]} [hotkeyDefinitions=[]] Contains hotkeys definitions
   * @returns {Object}
   */
  getValidHotkeyDefinitions(hotkeyDefinitions) {
    const definitions = this.getValidDefinitions(hotkeyDefinitions);
    const objectDefinitions = {};
    definitions.forEach(definition => {
      const { commandName, commandOptions } = definition;
      const commandHash = objectHash({ commandName, commandOptions });
      objectDefinitions[commandHash] = definition;
    });
    return objectDefinitions;
  }

  /**
   * It parses given object containing hotkeyDefinition to array like.
   * Each property of given object will be mapped to an object of an array. And its property name will be the value of a property named as commandName
   *
   * @param {HotkeyDefinition[] | Object} [hotkeyDefinitions={}] Contains hotkeys definitions
   * @returns {HotkeyDefinition[]}
   */
  _parseToArrayLike(hotkeyDefinitionsObj = {}) {
    const copy = { ...hotkeyDefinitionsObj };
    return Object.entries(copy).map(entryValue =>
      this._parseToHotKeyObj(entryValue[0], entryValue[1])
    );
  }

  /**
   * Return HotkeyDefinition object like based on given property name and property value
   * @param {string} propertyName property name of hotkey definition object
   * @param {object} propertyValue property value of hotkey definition object
   */
  _parseToHotKeyObj(propertyName, propertyValue) {
    return {
      commandName: propertyName,
      ...propertyValue,
    };
  }

  /**
   * Checks if a key combination is already in use by another command
   * @param {string | string[]} keys - The key combination to check
   * @param {string} excludeCommandHash - Optional command hash to exclude from the check
   * @returns {Object|null} Returns the conflicting hotkey definition or null if no conflict
   */
  private checkForKeyConflict(keys: string | string[], excludeCommandHash?: string): any | null {
    const normalizedKeys = this.normalizeKeys(keys);

    for (const [commandHash, hotkey] of Object.entries(this.hotkeyDefinitions)) {
      if (excludeCommandHash && commandHash === excludeCommandHash) {
        continue;
      }

      const existingNormalizedKeys = this.normalizeKeys(hotkey.keys);
      if (existingNormalizedKeys === normalizedKeys) {
        return hotkey;
      }
    }

    return null;
  }

  /**
   * Normalizes key combinations to a consistent format for comparison
   * @param {string | string[]} keys - The key combination to normalize
   * @returns {string} Normalized key string
   */
  private normalizeKeys(keys: string | string[]): string {
    if (!keys || keys === '') {
      return '';
    }

    const isKeyArray = Array.isArray(keys);
    const keyString = isKeyArray ? keys.join('+') : keys;

    // Convert to lowercase and sort modifiers for consistent comparison
    return keyString.toLowerCase().split('+').sort().join('+');
  }

  /**
   * (Unbinds and) binds the specified command to one or more key combinations.
   * When the hotkey combination is triggered, the command name and active contexts
   * are used to locate and execute the appropriate command.
   *
   * @param hotkey - The hotkey definition object.
   * @throws {Error} Throws an error if no commandName is provided.
   * @throws {Error} Throws an error if the key combination is already in use.
   */
  registerHotkeys({
    commandName,
    commandOptions = {},
    context,
    keys,
    label,
    isEditable,
  }: Hotkey): void {
    if (!commandName) {
      throw new Error(`No command was defined for hotkey "${keys}"`);
    }

    const commandHash = this.generateHash({ commandName, commandOptions });
    const existingHotkey = this.hotkeyDefinitions[commandHash];

    // If the hotkey has already been registered with the same keys, skip re-registration.
    if (existingHotkey && existingHotkey.keys === keys) {
      console.debug('HotkeysManager: Identical hotkey registration skipped.');
      return;
    }

    // Check for key conflicts with other commands (excluding current command)
    const conflictingHotkey = this.checkForKeyConflict(keys, commandHash);
    if (conflictingHotkey) {
      const error = `Key combination "${keys}" is already assigned to command "${conflictingHotkey.commandName}" (${conflictingHotkey.label}). Each key combination can only be used once.`;
      console.error('HotkeysManager:', error);

      // Notify user about the conflict
      const { uiNotificationService } = this._servicesManager.services;
      if (uiNotificationService) {
        uiNotificationService.show({
          title: 'Hotkey Conflict',
          message: error,
          type: 'error',
          duration: 5000,
        });
      }

      throw new Error(error);
    }

    const userPreferredKeys = JSON.parse(localStorage.getItem('user-preferred-keys') || '{}');

    if (existingHotkey) {
      userPreferredKeys[commandHash] = keys;
      localStorage.setItem('user-preferred-keys', JSON.stringify(userPreferredKeys));
      this._unbindHotkeys(commandName, existingHotkey.keys);
    }

    this.hotkeyDefinitions[commandHash] = { commandName, commandOptions, keys, label, isEditable };
    this._bindHotkeys(commandName, commandOptions, context, keys);
  }

  /**
   * Binds one or more set of hotkey combinations for a given command
   *
   * @private
   * @param {string} commandName - The name of the command to trigger when hotkeys are used
   * @param {string[]} keys - One or more key combinations that should trigger command
   * @returns {undefined}
   */
  _bindHotkeys(commandName, commandOptions = {}, context, keys) {
    const isKeyDefined = keys === '' || keys === undefined;
    if (isKeyDefined) {
      return;
    }

    const isKeyArray = keys instanceof Array;
    const combinedKeys = isKeyArray ? keys.join('+') : keys;

    mouseTrapAPI.bind(combinedKeys, evt => {
      evt.preventDefault();
      evt.stopPropagation();
      this._commandsManager.runCommand(commandName, { evt, ...commandOptions }, context);
      this._broadcastEvent(HotkeysManager.EVENTS.HOTKEY_PRESSED, {
        commandName,
        commandOptions,
        keys: combinedKeys,
        context,
        evt,
      });
    });
  }

  /**
   * unbinds one or more set of hotkey combinations for a given command
   *
   * @private
   * @param {string} commandName - The name of the previously bound command
   * @param {string[]} keys - One or more sets of previously bound keys
   * @returns {undefined}
   */
  _unbindHotkeys(commandName, keys) {
    const isKeyDefined = keys !== '' && keys !== undefined;
    if (!isKeyDefined) {
      return;
    }

    const isKeyArray = keys instanceof Array;
    if (isKeyArray) {
      const combinedKeys = keys.join('+');
      this._unbindHotkeys(commandName, combinedKeys);
      return;
    }

    mouseTrapAPI.unbind(keys);
  }
}

export default HotkeysManager;
