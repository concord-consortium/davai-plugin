import { Instance, types } from "mobx-state-tree";
import { timeStamp } from "../utils/utils";
import { DAVAI_SPEAKER } from "../constants";
import { MessageContent } from "../types";

const MessageModel = types.model("MessageModel", {
  speaker: types.string,
  messageContent: types.frozen(),
  timestamp: types.string,
});

export const ChatTranscriptModel = types
  .model("ChatTranscriptModel", {
    messages: types.array(MessageModel),
  })
  .actions((self) => ({
    addMessage(speaker: string, messageContent: MessageContent) {
      self.messages.push({
        speaker,
        messageContent,
        timestamp: timeStamp(),
      });
    },
    clearTranscript() {
      self.messages.clear();
    },
  }));

export interface ChatTranscriptModelType extends Instance<typeof ChatTranscriptModel> {}
export const transcriptStore = ChatTranscriptModel.create({
  messages: [
    {
      speaker: DAVAI_SPEAKER,
      messageContent: {
        content: "Hello! I'm DAVAI, your Data Analysis through Voice and Artificial Intelligence partner."
      },
      timestamp: timeStamp()
    }
  ]
});
