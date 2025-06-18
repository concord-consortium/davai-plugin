import { BaseMessage, SystemMessage } from "@langchain/core/messages";
import { CHARS_PER_TOKEN } from "../constants.js";

export const tokenCounter = (messages: BaseMessage[]): number => {
  let count = 0;

  for (const msg of messages) {
    // Don't count system messages towards the token limit.
    if (msg instanceof SystemMessage) continue;

    count += msg.content.length;
  }

  return count / CHARS_PER_TOKEN;
};

export const extractToolCalls = (lastMessage: BaseMessage | undefined): any[] => {
  if (!lastMessage || !("tool_calls" in lastMessage) || !Array.isArray((lastMessage as any).tool_calls)) {
    return [];
  }
  
  return (lastMessage as any).tool_calls;
};
