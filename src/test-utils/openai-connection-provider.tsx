import React from "react";
import { OpenAIConnectionContext } from "../contexts/openai-connection-provider";
import { OpenAI } from "openai";

const assistant: Partial<OpenAI.Beta.Assistant> = {
  id: "asst_abc123",
  name: "Jest Mock Assistant",
};
const listAssistants: Partial<OpenAI.Beta.Assistants["list"]> = jest.fn(() => {
  return { data: [assistant]};
});

const assistants: Partial<OpenAI.Beta.Assistants> = {
  create: jest.fn(),
  del: jest.fn(),
  list: listAssistants as OpenAI.Beta.Assistants["list"],
  retrieve: jest.fn(),
  update: jest.fn()
};

const beta: Partial<OpenAI.Beta> = {
  assistants: assistants as OpenAI.Beta.Assistants,
};

const mockOpenAiConnection: Partial<OpenAI> = {
  apiKey: "mock-api-key",
  beta: beta as OpenAI.Beta,
  organization: "mock-organization",
  project: "mock-project"
};

export const MockOpenAiConnectionProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  return (
    <OpenAIConnectionContext.Provider value={mockOpenAiConnection as OpenAI}>
      {children}
    </OpenAIConnectionContext.Provider>
  );
};
