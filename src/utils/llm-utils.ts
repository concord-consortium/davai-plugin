import { openAiTools } from "./codap-utils";
import { newOpenAI } from "./openai-utils";

export const initLlmConnection = () => {
  return newOpenAI();
};

export const getTools = () => {
  return openAiTools;
};
