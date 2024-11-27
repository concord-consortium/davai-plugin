import { types } from "mobx-state-tree";
import { timeStamp } from "../utils/utils";
import { DAVAI_SPEAKER } from "../constants";

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

export const transcriptStore = ChatTranscriptModel.create({
  messages: [{speaker: DAVAI_SPEAKER, content: "Hello! I'm DAVAI, your Data Analysis through Voice and Artificial Intelligence partner.", timestamp: timeStamp()
  }]
});
