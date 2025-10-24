import { getSnapshot, getType, IAnyStateTreeNode, isModelType, onSnapshot } from "mobx-state-tree";
import deepEqual from "fast-deep-equal";
import { loadMSTSettingOverrides, mergeWithArrayCopy, SettingsSource } from "./load-mst-settings";

/**
 * This function returns an object with only the properties that differ between objA and objB.
 * If the value is an array, the full array is included in the diff if the arrays are not deeply equal.
 */
export function diffObjects(objA: any, objB: any): any {
  const diff: any = {};
  for (const key in objB) {
    if (Array.isArray(objB[key]) && !deepEqual(objA[key], objB[key])) {
      diff[key] = objB[key];
    } else if (typeof objB[key] === "object" && objB[key] !== null && objA[key]) {
      const nestedDiff = diffObjects(objA[key], objB[key]);
      if (Object.keys(nestedDiff).length > 0) {
        diff[key] = nestedDiff;
      }
    } else if (objA[key] !== objB[key]) {
      diff[key] = objB[key];
    }
  }
  return diff;
}

/**
 * For every primitive value or array in the currentSettings, generate a result object with 
 * the same structure but the values are from the snapshot instead of the current settings.
 */
export function updateSavedValues(currentSavedSettings: any, snapshot: any): any {
  const updatedSettings: any = {};
  for (const key in currentSavedSettings) {
    // Arrays are replaced entirely
    if (Array.isArray(currentSavedSettings[key])) {
      updatedSettings[key] = snapshot[key];
    }
    // For nested objects, recurse
    else if (typeof currentSavedSettings[key] === "object" && currentSavedSettings[key] !== null) {
      updatedSettings[key] = updateSavedValues(currentSavedSettings[key], snapshot[key]);
    }
    // For primitive values, just take the current snapshot value
    else {
      updatedSettings[key] = snapshot[key];
    }
  }
  return updatedSettings;
}

export interface ISettingsDestination {
  setItem(key: string, value: string): void;
}

/**
 * Given an MST model add an onSnapshot listener that saves changes from the initial snapshot
 * into a settings destination. Typically this destination would be localStorage or similar.
 * Additionally it uses a SettingsSource to make sure that settings that have been saved before
 * are kept up to date with the current snapshot.
 *
 * @param instance The MST model instance to watch for changes.
 * @param settingsDestination The destination to save settings into.
 * @param settingsSource The source of settings to load from.
 * @param prefix An optional prefix to add to each setting key.
 * @param depth The depth at which to save settings. If 0, saves the entire snapshot as a single JSON object under the prefix key.
 *              If 1, saves each top-level property as a separate setting under the prefix + property name.
 */
export function addMSTSettingsSaver(
    instance: IAnyStateTreeNode, 
    settingsDestination: ISettingsDestination,
    settingsSource: SettingsSource,
    prefix = "",
    depth: 0 | 1 = 1,
) {

  const modelType = getType(instance);
  if (!isModelType(modelType)) {
    throw new Error("addMSTSettingsSaver: instance must be a model type");
  }

  const initialSnapshot = getSnapshot(instance);

  onSnapshot(instance, (snapshot) => {
    // The plan is to read the current diff stored in storage, then for each
    // key (including nested keys) we update that value with the current
    // value from the snapshot. And then we add in any new keys that have been
    // changed that are identified by this diff.
    //
    // To find the nested keys we need a recursive function almost identical to 
    // diffObjects. Excpet that when it finds a primative value or array in the 
    // storage object it saves the current value from the snapshot in the result.
    //
    // In order to prevent multiple writes to storage, after we get this result
    // we then merge it with the current diff which will add any new keys that
    // were modified in this specific change.

    const currentSavedSettings = loadMSTSettingOverrides(
      modelType,
      settingsSource,
      prefix
    );

    const updatedSettings = updateSavedValues(currentSavedSettings, snapshot);

    // Find all changes from the initialSnapshot, this is how new keys that have
    // changed values that aren't stored in the settingsDestination are
    // identified.
    const diff = diffObjects(initialSnapshot, snapshot);

    // Merge the diff into the updated settings:
    const settingsToSave = mergeWithArrayCopy(updatedSettings, diff);
    
    if (depth === 0) {
      if (!prefix) {
        throw new Error("addMSTSettingsSaver: prefix is required when depth is 0");
      }
      // At depth 0 we save the entire snapshot under the prefix key
      settingsDestination.setItem(prefix, JSON.stringify(settingsToSave));
      return;
    }

    Object.entries(settingsToSave).forEach(([key, value]) => {
      const settingKey = `${prefix}${key}`;
      const valueString = (typeof value === "object") ? JSON.stringify(value) : String(value);
      settingsDestination.setItem(settingKey, valueString);
    });
  });
}
