import { TextEncoder } from "util";
import { ReadableStream } from "web-streams-polyfill";
global.TextEncoder = TextEncoder;
global.ReadableStream = ReadableStream as any;
import { escapeCurlyBraces } from "./rag-utils";


describe("escapeCurlyBraces", () => {
  it("should escape curly braces in text", () => {
    const input = "This is a test with {curly braces} and {{double braces}}.";
    const expected = "This is a test with {{curly braces}} and {{{{double braces}}}}.";
    expect(escapeCurlyBraces(input)).toBe(expected);
  });
});

