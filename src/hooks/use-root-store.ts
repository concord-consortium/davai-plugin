import { useMemo } from "react";
import { AssistantModel } from "../models/assistant-model";
import { ChatTranscriptModel } from "../models/chat-transcript-model";
import { DAVAI_SPEAKER, GREETING } from "../constants";
import { timeStamp } from "../utils/utils";
import { RootStore } from "../models/root-store";
import { GraphSonificationModel } from "../models/graph-sonification-model";
import { BinModel } from "../models/bin-model";
import { CODAPDocumentModel } from "../models/codap-document-model";
import { useAppConfig } from "./use-app-config-context";


export const useRootStore = () => {
  const { appConfig } = useAppConfig();

  const rootStore = useMemo(() => {
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

    return RootStore.create({
      assistantStore: AssistantModel.create({
        llmId: appConfig.llmId,
        transcriptStore: newTranscriptStore,
      }),
      documentStore: CODAPDocumentModel.create({
        graphStore: GraphSonificationModel.create({
        binValues: BinModel.create({
          values: []
        }),
      })})
    });
  }, [appConfig.llmId]);

  return rootStore;
};
