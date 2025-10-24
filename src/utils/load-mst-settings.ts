import { applySnapshot, getSnapshot, getType, IAnyModelType, IAnyStateTreeNode, IAnyType, isArrayType, isFrozenType, isLiteralType, isModelType, isOptionalType, isUnionType, types } from "mobx-state-tree";
import merge from "deepmerge";

export type SettingsSourceValue = string | null | undefined;

export abstract class SettingsSource {
  abstract getItem(key: string): SettingsSourceValue;

  abstract hasKeyStartingWith(keyPrefix: string): boolean;

  getNumber(key: string, value: SettingsSourceValue): number | undefined {
    // If the value is null or undefined we treat it as undefined
    // This way settings sources like localStorage that return null for missing keys
    // will not override existing values
    // Number(null) is 0 which is not what we want
    if (value == null) {
      return undefined;
    }
    const num = Number(value);
    return isNaN(num) ? undefined : num;
  }

  getBoolean(key: string, value: SettingsSourceValue): boolean | undefined {
    // If the value is null or undefined we treat it as undefined
    // This way settings sources like localStorage that return null for missing keys
    // will not override existing values
    // The URL Param source modifies this behavior so a parameter that exists with no value
    // is treated as true
    if (value == null) {
      return undefined;
    }
    if (value === "true") {
      return true;
    }
    return false;
  }

  getSetting(key: string, propertyType: IAnyType): any {
    const item = this.getItem(key);

    // Handle primitive types
    if (propertyType === types.number || 
      isOptionalType(propertyType) && (propertyType as any).getSubTypes() === types.number
    ) {
      return this.getNumber(key, item);
    }

    if (propertyType === types.boolean ||
      isOptionalType(propertyType) && (propertyType as any).getSubTypes() === types.boolean
    ) {
      return this.getBoolean(key, item);
    }

    if (item == null) {
      return undefined;
    }

    if (propertyType === types.string ||
      isOptionalType(propertyType) && (propertyType as any).getSubTypes() === types.string
    ) {
      return item;
    }
    
    // Handle enumeration types - check if this is an enumeration type
    if (isUnionType(propertyType)) {
      // The getSubTypes method is not exposed by the MST types
      const subTypes = (propertyType as any).getSubTypes() as IAnyType[];
      if (subTypes.every((subType) => (
        subType === types.string) || 
        (isLiteralType(subType) && typeof (subType as any).value === "string")
      )) {
        // This is an enumeration of strings just return the value
        return item;
      }
    }
    
    // For arrays and frozen types, try to parse as JSON
    if (isArrayType(propertyType) || isFrozenType(propertyType)) {
      try {
        return JSON.parse(item);
      } catch {
        return undefined;
      }
    }
    
    // For nested models, try to parse as JSON
    if (isModelType(propertyType)) {
      try {
        return JSON.parse(item);
      } catch {
        return undefined;
      }
    }
    
    // If we can't process the type return undefined
    return undefined;
  }
}

class LocalStorageSettingsSource extends SettingsSource {
  getItem(key: string): SettingsSourceValue {
    return localStorage.getItem(key);
  }

  hasKeyStartingWith(keyPrefix: string): boolean {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(keyPrefix)) {
        return true;
      }
    }
    return false;
  }
}

export const localStorageSettingsSource = new LocalStorageSettingsSource();

class UrlParamSettingsSource extends SettingsSource {
  getItem(key: string): SettingsSourceValue {
    const params = new URLSearchParams(window.location.search);
    return params.get(key);
  }

  hasKeyStartingWith(keyPrefix: string): boolean {
    const params = new URLSearchParams(window.location.search);
    for (const key of params.keys()) {
      if (key.startsWith(keyPrefix)) {
        return true;
      }
    }
    return false;
  }

  getBoolean(key: string, value: SettingsSourceValue): boolean | undefined {
    // Simple case the value is true
    if (value === "true") {
      return true;
    }

    const params = new URLSearchParams(window.location.search);
    if (params.has(key)) {
      // If the value is null and the key exists it means its a value-less param so treat as true
      if (value === null) {
        return true;
      } else {
        return false;
      }
    } else {
      return undefined;
    }
  }
}

export const urlParamSettingsSource = new UrlParamSettingsSource();

/**
 * Recursively reads properties from local storage and overrides the snapshot values.
 * For nested properties, uses dot notation as the local storage key (e.g., "accessibility.keyboardShortcuts.focusChatInput").
 * Converts string values from local storage to the appropriate types based on the MST model schema.
 *
 * @param instance - The AppConfigModel instance to read the current snapshot from
 * @returns A new snapshot with values overridden from local storage
 */
export function loadMSTSettingOverrides(
  rootModelType: IAnyModelType, 
  settingsSource: SettingsSource, 
  prefix = ""
): any {

  /**
   * Recursively traverses the model type and checks local storage for each property
   * TODO: add support for arrays
   */
  function traverseAndApply(modelType: IAnyModelType, currentPath: string, result: any): any {    
    for (const [key, propertyType] of Object.entries(modelType.properties)) {      
      const path = currentPath ? `${currentPath}.${key}` : key;
      const fullPath = `${prefix}${path}`;
      const settingsValue = settingsSource.getSetting(fullPath, propertyType as IAnyType);

      // If we have a value in settingsSource save it
      if (settingsValue !== undefined) {
        result[key] = settingsValue;
      } else if (isModelType(propertyType) && settingsSource.hasKeyStartingWith(fullPath + ".")) {
        // Add an empty object to the result if it doesn't exist
        // If the object was specified as a json object its settingsValue would not be undefined,
        // so we won't get to this point.
        // If the settingsSource doesn't have any keys that start with fullPath + "." 
        // then we don't add an object to store these values
        result[key] = {};

        // Recursively process nested model types
        result[key] = traverseAndApply(propertyType, fullPath, result[key]);
      }
    }
    
    return result;    
  }
    
  // Start traversal from the root model
  return traverseAndApply(rootModelType, "", {});
}

/**
 * Merge y "into" x but don't update x instead return the result. 
 * If there is an array in y it is copied entirely into the result.
 * @param x 
 * @param y 
 * @returns 
 */
export function mergeWithArrayCopy(x: any, y: any): any {
  return merge(x, y, {
    // overwrite array values
    arrayMerge: (destinationArray, sourceArray) => sourceArray,
  });
}

export function loadAndApplyMSTSettingOverrides(
  instance: IAnyStateTreeNode, 
  settingsSource: SettingsSource,
  prefix = "",
) {
  const modelType = getType(instance);
  if (!isModelType(modelType)) {
    throw new Error("loadAndApplyMSTSettingOverrides: instance must be a model type");
  }
  const overrides = loadMSTSettingOverrides(modelType, settingsSource, prefix);  
  const snapshot = getSnapshot(instance);
  const newSnapshot = mergeWithArrayCopy(snapshot, overrides);
  applySnapshot(instance, newSnapshot);
}
