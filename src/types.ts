export const AppModeValues = ["development", "production", "test"] as const;
export type AppMode = typeof AppModeValues[number];
export const isAppMode = (value: unknown): value is AppMode => {
  return AppModeValues.includes(value as AppMode);
};

export type AppConfig = {
  accessibility: {
    keyboardShortcut: string;
  };
  assistantId: string;
  dimensions: {
    height: number;
    width: number;
  };
  mockAssistant?: boolean;
  mode: AppMode;
};

export type IUserOptions = {
  keyboardShortcutEnabled: boolean;
  keyboardShortcutKeys: string;
  playProcessingMessage: boolean;
  playProcessingTone: boolean;
  playbackSpeed: number;
  readAloudEnabled: boolean;
  showDebugLog: boolean;
};

export type MessageContent = {
  description?: string;
  content: string;
};

export type ChatMessage = {
  messageContent: MessageContent;
  speaker: string;
  timestamp: string;
  id: string;
};

export type ChatTranscript = {
  messages: ChatMessage[];
};

// CODAP API Types //

export interface Attribute {
  name: string;
  formula?: string;
  description?: string;
  type?: string;
  cid?: string;
  precision?: string;
  unit?: string;
  editable?: boolean;
  renameable?: boolean;
  deleteable?: boolean;
  hidden?: boolean;
}

export interface CodapItemValues {
  [attr: string]: any;
}

export interface CodapItem {
  id: number|string;
  values: CodapItemValues;
}

export type Action = "create" | "get" | "update" | "delete";
