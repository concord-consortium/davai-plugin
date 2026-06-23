import { ChatMessage } from "../types";
import { formatTranscriptForCapture, getLlmLabel, getTranscriptFilename } from "./transcript-utils";

const messages: ChatMessage[] = [
  {
    speaker: "User",
    timestamp: "T1",
    id: "1",
    messageContent: { content: "**bold** question" },
    plainTextContent: "bold question",
  },
  {
    speaker: "DAVAI",
    timestamp: "T2",
    id: "2",
    messageContent: { content: "the _answer_" },
    plainTextContent: "the answer",
  },
  {
    speaker: "Debug Log",
    timestamp: "T3",
    id: "3",
    messageContent: { description: "tool call", content: "{\"a\":1}" },
    plainTextContent: "",
  },
];

describe("formatTranscriptForCapture", () => {
  const text = formatTranscriptForCapture(messages, {
    capturedAt: "CAPTURE_TIME",
    llmLabel: "Anthropic: claude-haiku-4-5",
  });

  it("includes a header with capture time and LLM label", () => {
    expect(text).toContain("DAVAI Chat Transcript");
    expect(text).toContain("Captured: CAPTURE_TIME");
    expect(text).toContain("LLM: Anthropic: claude-haiku-4-5");
  });

  it("renders normal messages as speaker + timestamp + stripped text", () => {
    expect(text).toContain("User (T1):\nbold question");
    expect(text).toContain("DAVAI (T2):\nthe answer");
    expect(text).not.toContain("**bold**");
  });

  it("includes debug-log entries with description and raw content", () => {
    expect(text).toContain("Debug Log (T3):\ntool call\n{\"a\":1}");
  });
});

describe("getLlmLabel", () => {
  it("formats provider and id", () => {
    expect(getLlmLabel("{\"id\":\"claude-haiku-4-5\",\"provider\":\"Anthropic\"}"))
      .toBe("Anthropic: claude-haiku-4-5");
  });

  it("falls back to Unknown LLM for bad JSON", () => {
    expect(getLlmLabel("not json")).toBe("Unknown LLM");
  });
});

describe("getTranscriptFilename", () => {
  it("builds a dated, LLM-named filename", () => {
    const name = getTranscriptFilename(
      "{\"id\":\"claude-haiku-4-5\",\"provider\":\"Anthropic\"}",
      new Date(2026, 5, 23)
    );
    expect(name).toBe("davai-transcript-2026-06-23-claude-haiku-4-5.txt");
  });

  it("sanitizes unsafe characters in the id", () => {
    const name = getTranscriptFilename(
      "{\"id\":\"gpt-4o/mini\",\"provider\":\"OpenAI\"}",
      new Date(2026, 0, 5)
    );
    expect(name).toBe("davai-transcript-2026-01-05-gpt-4o-mini.txt");
  });

  it("falls back to unknown-llm for unparseable llmId", () => {
    const name = getTranscriptFilename("not json", new Date(2026, 5, 23));
    expect(name).toBe("davai-transcript-2026-06-23-unknown-llm.txt");
  });
});
