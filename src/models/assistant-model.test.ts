import { AssistantModel } from "./assistant-model";
import { ChatTranscriptModel } from "./chat-transcript-model";
import { postMessage } from "../utils/llm-utils";

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
});
