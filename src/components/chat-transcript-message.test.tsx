import { toMarkdownString } from "./chat-transcript-message";

describe("toMarkdownString", () => {
  it("passes a string through unchanged", () => {
    expect(toMarkdownString("hello world")).toBe("hello world");
  });

  it("extracts and joins text from an Anthropic content-block array", () => {
    const content = [{ type: "text", text: "a" }, { type: "tool_use", id: "x" }, { type: "text", text: "b" }];
    expect(toMarkdownString(content)).toBe("ab");
  });

  it("coerces nullish content to an empty string (never crashes react-markdown)", () => {
    expect(toMarkdownString(null)).toBe("");
    expect(toMarkdownString(undefined)).toBe("");
  });
});
