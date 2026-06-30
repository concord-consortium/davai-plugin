import { appendedText, extractCompletedChunks } from "./stream-utils";

describe("appendedText", () => {
  it("returns the new tail when cumulative extends shown", () => {
    expect(appendedText("Hello", "Hello world")).toBe(" world");
  });
  it("returns the full cumulative if it is not a continuation (defensive)", () => {
    expect(appendedText("Hello", "Goodbye")).toBe("Goodbye");
  });
  it("returns empty when nothing new", () => {
    expect(appendedText("Hello", "Hello")).toBe("");
  });
});

describe("extractCompletedChunks", () => {
  it("emits completed sentences and holds the incomplete tail", () => {
    const { chunks, remainder } = extractCompletedChunks("One. Two! Three");
    expect(chunks).toEqual(["One.", "Two!"]);
    expect(remainder).toBe(" Three");
  });
  it("emits a completed list item terminated by a newline", () => {
    const { chunks, remainder } = extractCompletedChunks("- a\n- b");
    expect(chunks).toEqual(["- a"]);
    expect(remainder).toBe("- b");
  });
  it("does not split inside an unclosed code block", () => {
    const { chunks, remainder } = extractCompletedChunks("Here:\n```\nx = 1.\ny = 2");
    expect(chunks).toEqual(["Here:"]);
    expect(remainder).toBe("```\nx = 1.\ny = 2");
  });
  it("emits a closed code block as one chunk", () => {
    const { chunks } = extractCompletedChunks("```\nx = 1\n```\n");
    expect(chunks).toEqual(["```\nx = 1\n```"]);
  });
  it("returns no chunks when nothing is complete", () => {
    expect(extractCompletedChunks("partial")).toEqual({ chunks: [], remainder: "partial" });
  });
});
