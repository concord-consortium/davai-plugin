import { useMemo } from "react";
import { AssistantModel } from "../models/assistant-model";
import { useChatTranscriptStore } from "./use-chat-transcript-store";
import { useOpenAIContext } from "./use-open-ai-context";

export const useAssistantStore = () => {
  const apiConnection = useOpenAIContext();
  const transcriptStore = useChatTranscriptStore();
  const assistantStore = useMemo(() => {
    return AssistantModel.create({transcriptStore, apiConnection});
  }, [transcriptStore, apiConnection]);

  return assistantStore;
};
