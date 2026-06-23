import { ChatMessage } from "../types";
import { copyTextToClipboard, downloadTextFile, formatTranscriptForCapture, getTranscriptFilename } from "./transcript-utils";

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
  const csv = formatTranscriptForCapture(messages);
  const lines = csv.replace(/\r\n$/, "").split("\r\n");

  it("starts with a CSV header row", () => {
    expect(lines[0]).toBe('"timestamp","speaker","debug event","message"');
  });

  it("renders normal messages with a blank debug event and markdown-stripped text", () => {
    expect(lines[1]).toBe('"T1","User","","bold question"');
    expect(lines[2]).toBe('"T2","DAVAI","","the answer"');
    expect(csv).not.toContain("**bold**");
  });

  it("renders debug-log entries with the description in debug event and raw content in message", () => {
    expect(lines[3]).toBe('"T3","Debug Log","tool call","{""a"":1}"');
  });

  it("quotes every field and escapes embedded quotes and commas", () => {
    const out = formatTranscriptForCapture([
      {
        speaker: "User",
        timestamp: "T",
        id: "x",
        messageContent: { content: 'has "quote", and comma' },
        plainTextContent: 'has "quote", and comma',
      },
    ]);
    expect(out).toContain('"T","User","","has ""quote"", and comma"');
  });
});

describe("getTranscriptFilename", () => {
  it("builds a dated, LLM-named filename", () => {
    const name = getTranscriptFilename(
      "{\"id\":\"claude-haiku-4-5\",\"provider\":\"Anthropic\"}",
      new Date(2026, 5, 23)
    );
    expect(name).toBe("davai-transcript-2026-06-23-claude-haiku-4-5.csv");
  });

  it("sanitizes unsafe characters in the id", () => {
    const name = getTranscriptFilename(
      "{\"id\":\"gpt-4o/mini\",\"provider\":\"OpenAI\"}",
      new Date(2026, 0, 5)
    );
    expect(name).toBe("davai-transcript-2026-01-05-gpt-4o-mini.csv");
  });

  it("falls back to unknown-llm for unparseable llmId", () => {
    const name = getTranscriptFilename("not json", new Date(2026, 5, 23));
    expect(name).toBe("davai-transcript-2026-06-23-unknown-llm.csv");
  });
});

describe("downloadTextFile", () => {
  it("creates an object URL, clicks a download anchor, and revokes the URL", () => {
    const createObjectURL = jest.fn(() => "blob:url");
    const revokeObjectURL = jest.fn();
    (global.URL as any).createObjectURL = createObjectURL;
    (global.URL as any).revokeObjectURL = revokeObjectURL;

    let anchor: HTMLAnchorElement | undefined;
    const realCreate = document.createElement.bind(document);
    const createElementSpy = jest.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const el = realCreate(tag);
      if (tag === "a") anchor = el as HTMLAnchorElement;
      return el;
    });
    const clickSpy = jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);

    downloadTextFile("my-file.txt", "hello");

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(anchor?.download).toBe("my-file.txt");
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:url");

    createElementSpy.mockRestore();
    clickSpy.mockRestore();
  });
});

describe("copyTextToClipboard", () => {
  it("writes the text via the clipboard API", async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    await copyTextToClipboard("hello clipboard");

    expect(writeText).toHaveBeenCalledWith("hello clipboard");
  });
});
