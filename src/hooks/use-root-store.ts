import { useMemo } from "react";
import { AssistantModel } from "../models/assistant-model";
import { ChatTranscriptModel } from "../models/chat-transcript-model";
import { DAVAI_SPEAKER, GREETING } from "../constants";
import { timeStamp } from "../utils/utils";
import { RootStore } from "../models/root-store";
import { GraphSonificationModel } from "../models/graph-sonification-model";
import { BinModel } from "../models/bin-model";

export const useRootStore = () => {
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
        transcriptStore: newTranscriptStore,
      }),
      sonificationStore: GraphSonificationModel.create({
        // selectedGraph: undefined,
        binValues: BinModel.create({
          values: []
        }),
      })
    });
  }, []);

  return rootStore;
};
