export type Mode = "development" | "production" | "test";
export const isMode = (value: unknown): value is Mode => {
  return value === "development" || value === "production" || value === "test";
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
  mode: Mode;
};

export type ChatMessage = {
  content: string;
  speaker: string;
  timestamp: string;
};

export type ChatTranscript = {
  messages: ChatMessage[];
};
