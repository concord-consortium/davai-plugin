import { BaseMessage } from "@langchain/core/messages.js";
import { CHARS_PER_TOKEN } from "../constants.js";
import { tokenCounter, escapeCurlyBraces } from "./utils.js";

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

describe("escapeCurlyBraces", () => {
  it("should escape curly braces in text", () => {
    const input = "This is a test with {curly braces} and {{double braces}}.";
    const expected = "This is a test with {{curly braces}} and {{{{double braces}}}}.";
    expect(escapeCurlyBraces(input)).toBe(expected);
  });
});