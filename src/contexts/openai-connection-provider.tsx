import React, { createContext } from "react";
import { OpenAI } from "openai";

export const createNewConnection = () => {
  return new OpenAI({
    apiKey: process.env.REACT_APP_OPENAI_API_KEY || "fake-key",
    baseURL: process.env.REACT_APP_OPENAI_BASE_URL,
    dangerouslyAllowBrowser: true,
    organization: "org-jbU1egKECzYlQI73HMMi7EOZ",
    project: "proj_VsykADfoZHvqcOJUHyVAYoDG",
  });
};

export const OpenAIConnectionContext = createContext<OpenAI|undefined>(undefined);

export const OpenAIConnectionProvider = ({ children }: {children: React.ReactNode}) => {
  const apiConnection = createNewConnection();
  return (
    <OpenAIConnectionContext.Provider value={apiConnection}>
      {children}
    </OpenAIConnectionContext.Provider>
  );
};
