export type ChatMessage = {
  content: string;
  speaker: string;
  timestamp: string;
};

export type ChatTranscript = {
  messages: ChatMessage[];
};
