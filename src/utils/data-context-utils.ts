import { DATA_CONTEXT_MESSAGES } from "../constants";

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

interface ExtractedDataContext {
  dataContexts: Record<string, any>;
  type: "create" | "initial" | "remove" | "update";
}

export const extractDataContexts = (message: string): ExtractedDataContext | null => {
  try {
    // Check for initial data contexts
    if (message.startsWith(DATA_CONTEXT_MESSAGES.INITIAL.split("{contexts}")[0])) {
      const contexts = JSON.parse(
        message.substring(DATA_CONTEXT_MESSAGES.INITIAL.split("{contexts}")[0].length)
      );
      return { dataContexts: contexts, type: "initial" };
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
      return { dataContexts: { [name]: context }, type: "update" };
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
      return { dataContexts: { [name]: context }, type: "create" };
    }

    // Check for removed data context
    if (message === DATA_CONTEXT_MESSAGES.REMOVED.replace("{name}", "")) {
      const name = message.substring(
        DATA_CONTEXT_MESSAGES.REMOVED.split("{name}")[0].length,
        message.length - DATA_CONTEXT_MESSAGES.REMOVED.split("{name}")[1].length
      );
      return { dataContexts: { [name]: null }, type: "remove" };
    }

    return null;
  } catch (err) {
    console.error("Failed to extract data contexts:", err);
    return null;
  }
};
