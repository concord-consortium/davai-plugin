import { BaseMessage } from "@langchain/core/messages.js";
import { CHARS_PER_TOKEN } from "../constants.js";
import { tokenCounter, extractToolCalls } from "./utils.js";

describe("tokenCounter", () => {
  it("should count tokens correctly for a single message", () => {
    const messageLength = 32;
    const messages = [
      { content: `This sentence is ${messageLength} tokens long.` }
    ] as BaseMessage[];
    const count = tokenCounter(messages);
    expect(count).toBe(32 / CHARS_PER_TOKEN);
  });
});

describe ("extractToolCalls", () => {
  it("should return an empty array if no tool calls are present", () => {
    const messages = [
      { content: "This is a message without tool calls." }
    ] as BaseMessage[];
    const result = extractToolCalls(messages[0]);
    expect(result).toEqual([]);
  });

  it("should extract tool calls from the last message", () => {
    const toolCalls = [{ name: "exampleTool", args: {} }];
    const messages = [
      { content: "This is a message with tool calls.", tool_calls: toolCalls }
    ] as any as BaseMessage[];
    const result = extractToolCalls(messages[0]);
    expect(result).toEqual(toolCalls);
  });
});
