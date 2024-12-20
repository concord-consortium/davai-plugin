import { useMemo } from "react";
import { AssistantModel } from "../models/assistant-model";
import { useOpenAIContext } from "./use-openai-context";
import { useAppConfigContext } from "./use-app-config-context";
import { ChatTranscriptModel } from "../models/chat-transcript-model";
import { DAVAI_SPEAKER, GREETING } from "../constants";
import { timeStamp } from "../utils/utils";

export const useAssistantStore = () => {
  const apiConnection = useOpenAIContext();
  const appConfig = useAppConfigContext();
  const assistantId = appConfig.assistantId;
  const assistantStore = useMemo(() => {
    const newTranscriptStore = ChatTranscriptModel.create({
      messages: [
        {
          speaker: DAVAI_SPEAKER,
          messageContent: { content: GREETING },
          timestamp: timeStamp(),
          id: "initial-message",
        },
      ],
    });

    return AssistantModel.create({
      apiConnection,
      assistantId,
      transcriptStore: newTranscriptStore
    });
  }, [apiConnection, assistantId]);

  return assistantStore;
};
