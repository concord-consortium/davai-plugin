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

export const escapeCurlyBraces = (text: string): string => {
  // Escape curly braces in JSON code blocks
  text = text.replace(/```json\n([\s\S]*?)\n```/g, (match) =>
    match.replace(/{/g, "{{").replace(/}/g, "}}")
  );

  // Escape curly braces in other parts of the text
  text = text.replace(/(?<!\\){/g, "{{").replace(/(?<!\\)}/g, "}}");

  return text;
};
