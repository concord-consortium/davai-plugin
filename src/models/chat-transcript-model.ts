import { Instance, types } from "mobx-state-tree";
import { timeStamp } from "../utils/utils";

const MessageModel = types.model("MessageModel", {
  speaker: types.string,
  content: types.string,
  timestamp: types.string,
});

export const ChatTranscriptModel = types
  .model("ChatTranscriptModel", {
    messages: types.array(MessageModel),
  })
  .actions((self) => ({
    addMessage(speaker: string, content: string) {
      self.messages.push({
        speaker,
        content,
        timestamp: timeStamp(),
      });
    },
    clearTranscript() {
      self.messages.clear();
    },
  }));

export interface ChatTranscriptModelType extends Instance<typeof ChatTranscriptModel> {}
