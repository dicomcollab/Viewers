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
    return 'https://med-pacs-dev-risapi-win.azurewebsites.net/api/v1/preferences';
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
   */
  async setHotkeys(
    hotkeyDefinitions: any[] | Record<string, any> = [],
    name = 'hotkey-definitions',
    saveToApi = true
  ) {
    try {
      const definitions = this.getValidDefinitions(hotkeyDefinitions);

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
   * Set default hotkey bindings. These
   * values are used in `this.restoreDefaultBindings`.
   *
   * @param {HotkeyDefinition[] | Object} [hotkeyDefinitions=[]] Contains hotkeys definitions
   * @param {boolean} [loadFromApi=true] Whether to load hotkeys from API preferences
   */
  async setDefaultHotKeys(hotkeyDefinitions = [], loadFromApi = true) {
    const definitions = this.getValidDefinitions(hotkeyDefinitions);
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
      const win = typeof window !== 'undefined' ? (window as Window & { fetchPreferences?: () => Promise<{ hotkeys?: Array<Record<string, any>> } | null> }) : null;
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
   * (Unbinds and) binds the specified command to one or more key combinations.
   * When the hotkey combination is triggered, the command name and active contexts
   * are used to locate and execute the appropriate command.
   *
   * @param hotkey - The hotkey definition object.
   * @throws {Error} Throws an error if no commandName is provided.
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
