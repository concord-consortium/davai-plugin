import { AppConfigModelSnapshot } from "../models/app-config-model";
import { AppMode } from "../types";

export const mockAppConfig: AppConfigModelSnapshot = {
  keyboardShortcuts: {
    focusChatInput: "Control+Shift+Slash",
    replayLastDavaiMessage: "Control+Shift+Comma",
    sonifyGraph: "Control+Shift+Period",
    captureTranscript: "Control+Shift+Semicolon"
  },
  keyboardShortcutsEnabled: true,
  playProcessingMessage: true,
  playProcessingTone: false,
  playbackSpeed: 1.0,
  readAloudEnabled: false,
  streamResponses: true,
  llmId: "{\"id\":\"mock\",\"provider\":\"Mock\"}",
  effort: "",
  llmList: [
    { id: "mock", provider: "Mock", effortLevels: [] },
    { id: "gemini-2.0-flash", provider: "Google", effortLevels: ["low", "medium", "high"], defaultEffort: "medium" },
    { id: "gpt-4o-mini", provider: "OpenAI", effortLevels: [] }
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
