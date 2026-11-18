import { tokenCounter, escapeCurlyBraces } from "./utils.js";

describe("tokenCounter", () => {
  it("should count tokens correctly for a single message", () => {
    const messageLength = 32;
    // Simple token estimation - roughly 4 characters per token
    const maxTokens = 4;
    const messages = [
      { content: `This sentence is ${messageLength} tokens long.` }
    ];
    const count = tokenCounter(messages);
    expect(count).toBe(messageLength / maxTokens);
  });
});

describe("escapeCurlyBraces", () => {
  it("should escape curly braces in text", () => {
    const input = "This is a test with {curly braces} and {{double braces}}.";
    const expected = "This is a test with {{curly braces}} and {{{{double braces}}}}.";
    expect(escapeCurlyBraces(input)).toBe(expected);
  });
});
