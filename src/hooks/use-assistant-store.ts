import { useMemo } from "react";
import { useAppConfigContext } from "./use-app-config-context";
import { AssistantModel } from "../models/assistant-model";
import { useChatTranscriptStore } from "./use-chat-transcript-store";

export const useAssistantStore = () => {
  const appConfig = useAppConfigContext();
  const transcriptStore = useChatTranscriptStore();
  const { assistantId, instructions, modelName, useExisting } = appConfig.assistant;
  const assistantStore = useMemo(() => {
    return AssistantModel.create({
      assistantId,
      modelName,
      instructions,
      transcriptStore,
      useExisting,
    });
  }, [assistantId, instructions, modelName, transcriptStore, useExisting]);

  return assistantStore;
};
