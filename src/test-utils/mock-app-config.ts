import { AppConfigModelSnapshot } from "../models/app-config-model";
import { AppMode } from "../types";

export const mockAppConfig: AppConfigModelSnapshot = {
  keyboardShortcuts: {
    focusChatInput: "Control+Shift+/",
    sonifyGraph: "Control+Shift+."
  },
  keyboardShortcutsEnabled: true,
  playProcessingMessage: true,
  playProcessingTone: false,
  playbackSpeed: 1.0,
  readAloudEnabled: false,
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
  mode: "test" as AppMode,
  sonify: {
    dotPlotMode: "continual" as const,
    maxPolyphony: 4,
    synthReleaseTime: 0.1,
    scatterPlotContinuousType: "lsrl" as const
  }
};
