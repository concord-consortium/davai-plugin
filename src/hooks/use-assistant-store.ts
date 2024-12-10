import { useMemo } from "react";
import { useAppConfigContext } from "./use-app-config-context";
import { AssistantModel } from "../models/assistant-model";
import { useChatTranscriptStore } from "./use-chat-transcript-store";

export const useAssistantStore = () => {
  const appConfig = useAppConfigContext();
  const transcriptStore = useChatTranscriptStore();
  const { assistantId, instructions, model, useExisting } = appConfig.assistant;
  const assistantStore = useMemo(() => {
    return AssistantModel.create({
      assistantId,
      model,
      instructions,
      transcriptStore,
      useExisting,
    });
  }, [assistantId, instructions, model, transcriptStore, useExisting]);

  return assistantStore;
};
