import { strFromU8, unzipSync } from "fflate";
import { ChatMessage } from "../types";
import { buildTranscriptCsv, buildTranscriptZip, copyTextToClipboard, downloadTextFile, getTranscriptFilename } from "./transcript-utils";

const imageDataUri = "data:image/png;base64,aGVsbG8=";
const debugWithImage: ChatMessage = {
  speaker: "Debug Log",
  timestamp: "T4",
  id: "4",
  messageContent: { description: "Response from CODAP", content: `{"exportDataUri":"${imageDataUri}"}` },
  plainTextContent: "",
};

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

describe("buildTranscriptCsv", () => {
  const { csv } = buildTranscriptCsv(messages);
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
    const { csv: out } = buildTranscriptCsv([
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

  it("returns no images when the transcript has none", () => {
    const { images } = buildTranscriptCsv(messages);
    expect(images).toHaveLength(0);
  });
});

describe("buildTranscriptCsv image extraction", () => {
  it("replaces a base64 image with an images/ reference and returns its bytes", () => {
    const { csv, images } = buildTranscriptCsv([debugWithImage]);
    expect(csv).toContain("images/image-001.png");
    expect(csv).not.toContain("aGVsbG8=");
    expect(images).toHaveLength(1);
    expect(images[0].filename).toBe("image-001.png");
    expect(images[0].bytes.length).toBeGreaterThan(0);
  });

  it("de-duplicates an identical image into one file referenced from both rows", () => {
    const second: ChatMessage = {
      ...debugWithImage,
      id: "5",
      timestamp: "T5",
      messageContent: { description: "Tool output generated", content: `{"url":"${imageDataUri}"}` },
    };
    const { csv, images } = buildTranscriptCsv([debugWithImage, second]);
    expect(images).toHaveLength(1);
    expect((csv.match(/images\/image-001\.png/g) || []).length).toBe(2);
  });

  it("numbers distinct images sequentially with an extension from the mime type", () => {
    const jpeg: ChatMessage = {
      ...debugWithImage,
      id: "6",
      timestamp: "T6",
      messageContent: { description: "img", content: "data:image/jpeg;base64,d29ybGQ=" },
    };
    const { images } = buildTranscriptCsv([debugWithImage, jpeg]);
    expect(images.map((i) => i.filename)).toEqual(["image-001.png", "image-002.jpg"]);
  });
});

describe("buildTranscriptZip", () => {
  it("bundles the CSV and images and round-trips via unzip", () => {
    const capture = buildTranscriptCsv([debugWithImage]);
    const entries = unzipSync(buildTranscriptZip(capture));
    expect(Object.keys(entries).sort()).toEqual(["images/image-001.png", "transcript.csv"]);
    expect(strFromU8(entries["transcript.csv"])).toContain("images/image-001.png");
    expect(strFromU8(entries["images/image-001.png"])).toBe("hello");
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

  it("uses the given extension", () => {
    const name = getTranscriptFilename(
      "{\"id\":\"mock\",\"provider\":\"Mock\"}",
      new Date(2026, 5, 23),
      "zip"
    );
    expect(name).toBe("davai-transcript-2026-06-23-mock.zip");
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
