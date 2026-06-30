import { messageTextToString, shouldFlush, isAbortError, withAccumulatedResponse } from "./stream-utils";

describe("messageTextToString", () => {
  it("returns a string unchanged", () => {
    expect(messageTextToString("hello")).toBe("hello");
  });
  it("joins text blocks from a content-block array and drops non-text", () => {
    const content = [{ type: "text", text: "a" }, { type: "tool_use", id: "x" }, { type: "text", text: "b" }];
    expect(messageTextToString(content)).toBe("ab");
  });
  it("returns empty string for null/other", () => {
    expect(messageTextToString(null)).toBe("");
    expect(messageTextToString(42)).toBe("");
  });
});

describe("shouldFlush", () => {
  it("flushes when a sentence ends since last write", () => {
    expect(shouldFlush("Hello world.", 0)).toBe(true);
  });
  it("flushes on a newline (e.g. a list item or code line)", () => {
    expect(shouldFlush("- item one\n", 0)).toBe(true);
  });
  it("does not flush mid-sentence below the size cap", () => {
    expect(shouldFlush("Hello wor", 0)).toBe(false);
  });
  it("only considers text added since lastWrittenLength", () => {
    expect(shouldFlush("Done. and more", "Done.".length)).toBe(false);
  });
  it("flushes a long unpunctuated run at the size cap", () => {
    expect(shouldFlush("x".repeat(200), 0)).toBe(true);
  });
});

describe("isAbortError", () => {
  it("is true when the signal is aborted", () => {
    const c = new AbortController(); c.abort();
    expect(isAbortError(new Error("boom"), c.signal)).toBe(true);
  });
  it("is true for an abort-named error even if signal not aborted", () => {
    const c = new AbortController();
    const e = new Error("the operation was aborted"); (e as any).name = "AbortError";
    expect(isAbortError(e, c.signal)).toBe(true);
  });
  it("is false for an ordinary error with an un-aborted signal", () => {
    const c = new AbortController();
    expect(isAbortError(new Error("400 bad request"), c.signal)).toBe(false);
  });
});

describe("withAccumulatedResponse", () => {
  it("attaches accumulated text to a tool-call payload that carries no response", () => {
    const toolOutput = { request: { foo: 1 }, status: "requires_action", tool_call_id: "t1", type: "x" };
    expect(withAccumulatedResponse(toolOutput, "Pre-tool text.")).toEqual({
      ...toolOutput, response: "Pre-tool text."
    });
  });
  it("does not overwrite an existing response (a plain text completion)", () => {
    const out = { response: "Full answer." };
    expect(withAccumulatedResponse(out, "ignored")).toEqual({ response: "Full answer." });
  });
  it("returns the payload unchanged when there is no accumulated text", () => {
    const out = { status: "requires_action", tool_call_id: "t1" };
    expect(withAccumulatedResponse(out, "")).toBe(out);
  });
});
