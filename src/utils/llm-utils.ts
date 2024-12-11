import { newOpenAI, openAiTools } from "./openai-utils";

export const initLlmConnection = () => {
  return newOpenAI();
};

export const getTools = () => {
  return openAiTools;
};
