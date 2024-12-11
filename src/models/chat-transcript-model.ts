import { Instance, types } from "mobx-state-tree";
import { timeStamp } from "../utils/utils";

const MessageModel = types.model("MessageModel", {
  speaker: types.string,
  content: types.string,
  timestamp: types.string,
});

/**
 * ChatTranscriptModel encapsulates the transcript of a chat between an AI assistant and the user.
 * It includes properties for adding messages and clearing the transcript.
 *
 * @property {Array<MessageModel>} messages - An array of messages in the chat transcript.
 * Each message includes details about the speaker, content, and timestamp.
 */
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
