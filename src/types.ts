export const AppModeValues = ["development", "production", "test"] as const;
export type AppMode = typeof AppModeValues[number];
export const isAppMode = (value: unknown): value is AppMode => {
  return AppModeValues.includes(value as AppMode);
};

export type AppConfig = {
  accessibility: {
    keyboardShortcut: string;
  };
  assistant: {
    assistantId: string;
    instructions: string;
    model: string;
    useExisting: boolean;
  };
  dimensions: {
    height: number;
    width: number;
  };
  mockAssistant?: boolean;
  mode: AppMode;
};

export type ChatMessage = {
  content: string;
  speaker: string;
  timestamp: string;
};

export type ChatTranscript = {
  messages: ChatMessage[];
};
