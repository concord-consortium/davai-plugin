export const DEBUG_SPEAKER = "Debug Log";
export const DAVAI_SPEAKER = "DAVAI";
export const USER_SPEAKER = "User";

// see: https://platform.openai.com/docs/api-reference/runs/object#runs/object-status
export const WAIT_STATES = new Set(["queued", "in_progress"]);
export const ERROR_STATES = new Set(["failed", "incomplete", "expired", "cancelled"]);

export const GREETING = `Hello! I'm DAVAI, your Data Analysis through Voice and Artificial Intelligence partner.`;

// we don't send case-level information, only info about dataContexts, collections + attributes
// documentation about CODAP Data Interactive API notifications: https://github.com/concord-consortium/codap/wiki/CODAP-Data-Interactive-Plugin-API#codap-initiated-actions
export const notificationsToIgnore = [
  "selectCases",
  "moveCases",
  "createCases",
  "createItems",
  "updateCases"
];

export const kDefaultChatInputHeight = 47;

export const STOP_RECORDING_NOTE = "D4";
export const START_RECORDING_NOTE = "B4";
export const LOADING_NOTE = "C4";

export const kDefaultOptions = {
  keyboardShortcutEnabled: true,
  keyboardShortcutKeys: "",
  playProcessingMessage: true,
  playProcessingTone: false,
  playbackSpeed: 1,
  readAloudEnabled: false,
  showDebugLog: false,
};

export const LLM_LIST: Record<string, string> = {
  "gpt-4o-mini": "OpenAI",
  "gemini-2.0-flash": "Google",
  "mock": "Mock Assistant"
};
