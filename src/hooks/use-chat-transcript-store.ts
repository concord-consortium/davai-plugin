import { useMemo } from "react";
import { ChatTranscriptModel } from "../models/chat-transcript-model";
import { timeStamp } from "../utils/utils";
import { DAVAI_SPEAKER } from "../constants";

export const useChatTranscriptStore = () => {
  const chatTranscriptStore = useMemo(() => {
    return ChatTranscriptModel.create({
      messages: [
        {
          speaker: DAVAI_SPEAKER,
          content: "Hello! I'm DAVAI, your Data Analysis through Voice and Artificial Intelligence partner.",
          timestamp: timeStamp(),
        },
      ],
    });
  }, []);

  return chatTranscriptStore;
};
