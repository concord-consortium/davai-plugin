import { AppMode } from "../types";

export const mockAppConfig = {
  accessibility: {
    keyboardShortcut: "ctrl+?"
  },
  assistant: {
    assistantId: "asst_abc123",
    instructions: "You are just a test AI. Don't do anything fancy.",
    model: "test-model",
    useExisting: true
  },
  dimensions: {
    height: 680,
    width: 380
  },
  mockAssistant: false,
  mode: "test" as AppMode,
};
