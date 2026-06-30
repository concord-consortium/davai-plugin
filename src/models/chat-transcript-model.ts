import { Instance, types } from "mobx-state-tree";
import { nanoid } from "nanoid";
import removeMarkdown from "remove-markdown";
import { timeStamp } from "../utils/utils";
import { MessageContent } from "../types";

const MessageModel = types.model("MessageModel", {
  speaker: types.string,
  messageContent: types.frozen<MessageContent>(),
  timestamp: types.string,
  id: types.identifier,
  isStreaming: types.optional(types.boolean, false),
})
.views((self) => ({
  get plainTextContent() {
    return removeMarkdown(self.messageContent.content, {stripListLeaders: false, useImgAltText: true});
  }
}));

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
    addMessage(speaker: string, messageContent: MessageContent) {
      self.messages.push({
        speaker,
        messageContent,
        timestamp: timeStamp(),
        id: nanoid(),
      });
    },
    clearTranscript() {
      self.messages.clear();
    },
    addStreamingMessage(speaker: string, messageContent: MessageContent): string {
      const id = nanoid();
      self.messages.push({ speaker, messageContent, timestamp: timeStamp(), id, isStreaming: true });
      return id;
    },
    appendToMessage(id: string, text: string) {
      const msg = self.messages.find((m) => m.id === id);
      if (msg) msg.messageContent = { ...msg.messageContent, content: msg.messageContent.content + text };
    },
    finalizeStreamingMessage(id: string, content: string) {
      const msg = self.messages.find((m) => m.id === id);
      if (msg) { msg.messageContent = { ...msg.messageContent, content }; msg.isStreaming = false; }
    },
    removeMessage(id: string) {
      const msg = self.messages.find((m) => m.id === id);
      if (msg) self.messages.remove(msg);
    },
  }));

export interface ChatTranscriptModelType extends Instance<typeof ChatTranscriptModel> {}
