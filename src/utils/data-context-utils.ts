import { DATA_CONTEXT_MESSAGES, DELIMITER } from "../constants";

/**
 * Trims the dataset to reduce its size.
 * Currently we only remove the `_categoryMap` attribute from all attributes in the dataset.
 * It may be extended in the future to perform additional optimizations.
 *
 * @param dataset - The dataset to be trimmed.
 * @returns A new dataset with some unnecessary items removed.
 */
export const trimDataset = (dataset: any): any => {
  const newDataset = structuredClone(dataset);
  const removeCategoryMap = (collection: Record<string, any>) => {
    for (const attr of collection.attrs) {
      if (attr._categoryMap) {
        delete attr._categoryMap;
      }
    }
  };

  // Handle case where `collections` is on the root object
  if (Array.isArray(newDataset.collections)) {
    for (const collection of newDataset.collections) {
      if (!Array.isArray(collection.attrs)) continue;

      removeCategoryMap(collection);
    }
  }

  // Handle case where `collections` is nested under context keys
  for (const contextKey of Object.keys(newDataset)) {
    const context = newDataset[contextKey];
    const collections = context?.collections;
    if (!Array.isArray(collections)) continue;

    for (const collection of collections) {
      if (!Array.isArray(collection.attrs)) continue;

      removeCategoryMap(collection);
    }
  }

  return newDataset;
};

export const formatDataContextMessage = (
  type: keyof typeof DATA_CONTEXT_MESSAGES,
  params: { name?: string; context?: any; contexts?: any }
) => {
  const template = DATA_CONTEXT_MESSAGES[type];
  return template
    .replace("{name}", params.name || "")
    .replace("{context}", JSON.stringify(params.context || {}))
    .replace("{contexts}", JSON.stringify(params.contexts || {}));
};

interface IExtractedDataContext {
  codapData: Record<string, any>;
  type: "combined" | "create" | "initial" | "remove" | "update";
}

/**
 * Extracts a structured data context from a given message string.
 *
 * @param message - The message string to extract data contexts from.
 *   Example: "Data context {name} has been updated: {context}"
 * @returns An object containing the extracted data contexts and type if the message matches
 *   patterns defined in DATA_CONTEXT_MESSAGES, or null if no match is found.
 */
export const extractDataContexts = (message: string): IExtractedDataContext | null => {
  try {
    // When the assistant model's `codapNotificationQueue` is populated, it may contain multiple messages. The assistant model
    // combines these messages into a single string, separated by newlines, to send together in one request to the LLM instead
    // of making multiple requests. We need to handle this case by splitting the `message` string on newlines and then combining
    // the extracted data from each message.
    const messages = message.split(DELIMITER).filter(msg => msg.trim());

    if (messages.length > 1) {
      const results = messages.map(msg => extractSingleDataContext(msg)).filter(result => result !== null);
      if (results.length === 0) return null;

      const combinedCodapData = results.reduce((acc, result) => {
        return { ...acc, ...result.codapData };
      }, {});
      
      return { codapData: combinedCodapData, type: "combined" };
    }

    // Single message case
    return extractSingleDataContext(message);

  } catch (err) {
    console.error("Failed to extract data contexts:", err);
    return null;
  }
};

/**
 * Extracts a single structured data context from a single data context message string.
 *
 * @param message - The message string to extract data contexts from.
 *   Example: "Data context {name} has been updated: {context}"
 * @returns An object containing the extracted data contexts and type if the message matches
 *   patterns defined in DATA_CONTEXT_MESSAGES, or null if no match is found.
 */
export const extractSingleDataContext = (message: string): IExtractedDataContext | null => {
  try {
    // Check for initial data contexts
    if (message.startsWith(DATA_CONTEXT_MESSAGES.INITIAL.split("{contexts}")[0])) {
      const contexts = JSON.parse(
        message.substring(DATA_CONTEXT_MESSAGES.INITIAL.split("{contexts}")[0].length)
      );
      return { codapData: trimDataset(contexts), type: "initial" };
    }

    // Check for updated data context
    const updatePrefix = DATA_CONTEXT_MESSAGES.UPDATED.split("{name}")[0];
    const updateSuffix = DATA_CONTEXT_MESSAGES.UPDATED.split("{context}")[1];
    if (message.startsWith(updatePrefix) && message.endsWith(updateSuffix)) {
      const name = message.substring(
        updatePrefix.length,
        message.length - updateSuffix.length - DATA_CONTEXT_MESSAGES.UPDATED.split("{name}")[1].length
      );
      const context = JSON.parse(
        message.substring(
          message.indexOf(": ") + 2,
          message.length - updateSuffix.length
        )
      );
      return { codapData: { [name]: trimDataset(context) }, type: "update" };
    }

    // Check for new data context
    const createPrefix = DATA_CONTEXT_MESSAGES.CREATED.split("{name}")[0];
    const createSuffix = DATA_CONTEXT_MESSAGES.CREATED.split("{context}")[1];
    if (message.startsWith(createPrefix) && message.endsWith(createSuffix)) {
      const name = message.substring(
        createPrefix.length,
        message.length - createSuffix.length - DATA_CONTEXT_MESSAGES.CREATED.split("{name}")[1].length
      );
      const context = JSON.parse(
        message.substring(
          message.indexOf(": ") + 2,
          message.length - createSuffix.length
        )
      );
      return { codapData: { [name]: trimDataset(context) }, type: "create" };
    }

    // Check for removed data context
    const removePrefix = DATA_CONTEXT_MESSAGES.REMOVED.split("{name}")[0];
    const removeSuffix = DATA_CONTEXT_MESSAGES.REMOVED.split("{name}")[1];
    if (message.startsWith(removePrefix) && message.endsWith(removeSuffix)) {
      const name = message.substring(
        DATA_CONTEXT_MESSAGES.REMOVED.split("{name}")[0].length,
        message.length - DATA_CONTEXT_MESSAGES.REMOVED.split("{name}")[1].length
      );
      return { codapData: { [name]: null }, type: "remove" };
    }

    // Check for updated graph
    const graphPrefix = DATA_CONTEXT_MESSAGES.GRAPH.split("{graph}")[0];
    if (message.startsWith(graphPrefix)) {
      const graph = JSON.parse(
        message.substring(graphPrefix.length, message.length - DATA_CONTEXT_MESSAGES.GRAPH.split("{graph}")[1].length)
      );
      return { codapData: { graph }, type: "update" };
    }

    return null;
  } catch (err) {
    console.error("Failed to extract data contexts:", err);
    return null;
  }
};
