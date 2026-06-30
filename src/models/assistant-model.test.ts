import { AssistantModel } from "./assistant-model";
import { ChatTranscriptModel } from "./chat-transcript-model";
import { postMessage } from "../utils/llm-utils";
import { DAVAI_SPEAKER } from "../constants";

jest.mock("../utils/llm-utils", () => ({
  postMessage: jest.fn(),
}));

const mockedPostMessage = postMessage as jest.MockedFunction<typeof postMessage>;

const createStore = () => {
  const transcriptStore = ChatTranscriptModel.create({ messages: [] });
  return AssistantModel.create({ transcriptStore, threadId: "thread-1" });
};

describe("AssistantModel streaming busy-state (DAVAI-118)", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it("queues a second message instead of starting a concurrent request while one is in flight", async () => {
    const store = createStore();
    // Every postMessage call parks on a never-resolving promise, so the first submit
    // stays "in flight" right after it sets isLoadingResponse = true. (We never await
    // the submits — the queued path returns immediately; a buggy concurrent path would
    // park on its own postMessage call, which the call-count assertion catches.)
    mockedPostMessage.mockReturnValue(new Promise<Response>(() => { /* never resolves */ }));

    store.handleMessageSubmit("first");
    await Promise.resolve();
    expect(store.isLoadingResponse).toBe(true);
    expect(mockedPostMessage).toHaveBeenCalledTimes(1);

    // A second submit while busy must NOT start another job (which would overwrite
    // currentMessageId and corrupt polling/cancel); it should be queued for later.
    store.handleMessageSubmit("second");
    await Promise.resolve();

    expect(mockedPostMessage).toHaveBeenCalledTimes(1);
    expect(store.messageQueue.slice()).toContain("second");
  });

  it("still reports isResponding while streaming after the Processing indicator is cleared", async () => {
    const store = createStore();
    mockedPostMessage.mockReturnValue(new Promise<Response>(() => { /* never resolves */ }));

    store.handleMessageSubmit("hello");
    await Promise.resolve();
    expect(store.isLoadingResponse).toBe(true);

    // Streaming clears the "Processing" indicator on the first chunk, but the input must
    // stay busy (cancel button up, submit blocked) — that's what isResponding expresses.
    store.setShowLoadingIndicator(false);
    expect(store.isResponding).toBe(true);
  });

  it("reports isResponding via showLoadingIndicator for the mock assistant (no isLoadingResponse)", () => {
    const store = createStore();
    expect(store.isResponding).toBe(false);
    store.setShowLoadingIndicator(true);
    expect(store.isResponding).toBe(true);
  });

  it("logs a single 'Completed response time' and no legacy 'Response time' on completion", async () => {
    const store = createStore();
    mockedPostMessage
      .mockResolvedValueOnce({ ok: true, json: async () => ({ messageId: "m1" }) } as Response) // submit
      .mockResolvedValueOnce({ ok: true, json: async () => ({ status: "completed", output: { response: "Hi there." } }) } as Response); // status poll

    await store.handleMessageSubmit("hello");

    const messages = store.transcriptStore.messages;
    expect(messages.some((m) => m.messageContent.content === "Hi there.")).toBe(true);
    const completed = messages.filter((m) => m.messageContent.description === "Completed response time");
    expect(completed).toHaveLength(1);
    const legacy = messages.filter((m) => (m.messageContent.description ?? "").startsWith("Response time"));
    expect(legacy).toHaveLength(0);
  });

  it("emits a 'Begin response time' for a non-streamed completion (paired with Completed)", async () => {
    const store = createStore();
    mockedPostMessage
      .mockResolvedValueOnce({ ok: true, json: async () => ({ messageId: "m1" }) } as Response) // submit
      .mockResolvedValueOnce({ ok: true, json: async () => ({ status: "completed", output: { response: "Hi there." } }) } as Response); // status poll

    await store.handleMessageSubmit("hello");

    const messages = store.transcriptStore.messages;
    const begin = messages.filter((m) => m.messageContent.description === "Begin response time");
    const completed = messages.filter((m) => m.messageContent.description === "Completed response time");
    expect(begin).toHaveLength(1);
    expect(completed).toHaveLength(1);
  });

  it("keeps the DAVAI response as the last transcript row for a non-streamed completion", async () => {
    // App's announce/speak effect for non-streamed responses keys off "last message is a
    // DAVAI message", so the timing debug rows must not be appended after the response.
    const store = createStore();
    store.setStreamEnabled(false);
    mockedPostMessage
      .mockResolvedValueOnce({ ok: true, json: async () => ({ messageId: "m1" }) } as Response) // submit
      .mockResolvedValueOnce({ ok: true, json: async () => ({ status: "completed", output: { response: "Hi there." } }) } as Response); // status poll

    await store.handleMessageSubmit("hello");

    const messages = store.transcriptStore.messages;
    const last = messages[messages.length - 1];
    expect(last.speaker).toBe(DAVAI_SPEAKER);
    expect(last.messageContent.content).toBe("Hi there.");
  });

  it("finalizes the in-progress streaming message if the turn throws after streaming started", async () => {
    const store = createStore();
    store.setStreamEnabled(true);
    mockedPostMessage
      .mockResolvedValueOnce({ ok: true, json: async () => ({ messageId: "m1" }) } as Response) // submit
      .mockResolvedValueOnce({ ok: true, json: async () => ({ status: "streaming", output: { response: "Partial..." } }) } as Response) // streamed chunk
      .mockResolvedValueOnce({ ok: false, statusText: "Boom" } as Response); // next status fetch throws

    await store.handleMessageSubmit("hello");

    // The streaming message must be finalized (not left stuck isStreaming) and keep its text.
    expect(store.transcriptStore.messages.some((m) => m.isStreaming)).toBe(false);
    expect(store.transcriptStore.messages.some((m) => m.messageContent.content === "Partial...")).toBe(true);
    expect(store.currentStreamingMessageId).toBeNull();
  });

  it("does not time out while the server reports streaming progress, even with streaming display off", async () => {
    const store = createStore();
    store.setStreamEnabled(false); // streaming display OFF — server still reports streaming status

    // Advance the clock 30s on each status poll, so the 60s idle budget would expire after
    // a couple of no-progress polls unless streaming statuses are counted as progress.
    let now = 0;
    const nowSpy = jest.spyOn(performance, "now").mockImplementation(() => now);
    const streaming = (resp: string) =>
      ({ ok: true, json: async () => { now += 30_000; return { status: "streaming", output: { response: resp } }; } } as unknown as Response);

    mockedPostMessage
      .mockResolvedValueOnce({ ok: true, json: async () => ({ messageId: "m1" }) } as Response) // submit
      .mockResolvedValueOnce(streaming("a"))
      .mockResolvedValueOnce(streaming("ab"))
      .mockResolvedValueOnce(streaming("abc"))
      .mockResolvedValueOnce({ ok: true, json: async () => ({ status: "completed", output: { response: "done" } }) } as Response);

    await store.handleMessageSubmit("hello");

    expect(store.transcriptStore.messages.some((m) => m.messageContent.content === "done")).toBe(true);
    expect(store.transcriptStore.messages.some((m) => m.messageContent.description === "Polling expired before response received")).toBe(false);

    nowSpy.mockRestore();
  });

  it("keeps pre-tool-call text on a mixed text+tool turn with streaming display off", async () => {
    const store = createStore();
    store.setStreamEnabled(false);
    store.setLlmId(JSON.stringify({ id: "gpt-4o-mini", provider: "OpenAI" })); // non-mock, so tool output is sent
    mockedPostMessage
      .mockResolvedValueOnce({ ok: true, json: async () => ({ messageId: "m1" }) } as Response) // message submit
      .mockResolvedValueOnce({ ok: true, json: async () => ({ status: "completed", output: {
        status: "requires_action", tool_call_id: "t1", type: "x",
        request: { status: "error", error: "nope" }, // error request → forwarded without a CODAP round-trip
        response: "Here is the explanation." // pre-tool text the server attached
      } }) } as Response) // status: tool call carrying pre-tool text
      .mockResolvedValueOnce({ ok: true, json: async () => ({ messageId: "m2" }) } as Response) // tool-output submit
      .mockResolvedValueOnce({ ok: true, json: async () => ({ status: "completed", output: { response: "Final answer." } }) } as Response); // tool status

    await store.handleMessageSubmit("hello");

    const contents = store.transcriptStore.messages.map((m) => m.messageContent.content);
    expect(contents).toContain("Here is the explanation."); // pre-tool text not dropped
    expect(contents).toContain("Final answer.");
  });
});
