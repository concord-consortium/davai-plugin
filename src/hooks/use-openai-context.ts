import { useContext } from "react";
import { OpenAI } from "openai";
import { OpenAIConnectionContext } from "../contexts/openai-connection-provider";

export const useOpenAIContext = (): OpenAI => {
  const context = useContext(OpenAIConnectionContext);
  if (!context) {
    throw new Error("useOpenAIContext must be used within a OpenAIConnectionContext.Provider");
  }
  return context;
};
