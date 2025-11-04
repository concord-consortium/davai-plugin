import { AppMode } from "../types";

export const mockAppConfig = {
  keyboardShortcuts: {
    focusChatInput: "Control+Shift+/"
  },
  llmId: "{ id: \"mock\", name: \"Mock LLM\" }",
  llmList: [
    { id: "mock", provider: "Mock" },
    { id: "gemini-2.0-flash", provider: "Google" },
    { id: "gpt-4o-mini", provider: "OpenAI" }
  ],
  dimensions: {
    height: 680,
    width: 380
  },
  mockAssistant: false,
  mode: "test" as AppMode,
  sonify: {
    maxPolyphony: 4,
    synthReleaseTime: 0.1,
  }
};
