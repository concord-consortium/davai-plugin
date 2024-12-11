import { useMemo } from "react";
import { ChatTranscriptModel } from "../models/chat-transcript-model";
import { timeStamp } from "../utils/utils";
import { DAVAI_SPEAKER, GREETING } from "../constants";

export const useChatTranscriptStore = () => {
  const chatTranscriptStore = useMemo(() => {
    return ChatTranscriptModel.create({
      messages: [
        {
          speaker: DAVAI_SPEAKER,
          messageContent: {content: GREETING},
          timestamp: timeStamp(),
        },
      ],
    });
  }, []);

  return chatTranscriptStore;
};
