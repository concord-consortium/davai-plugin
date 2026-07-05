import { AssistantModel } from "./assistant-model";
import { ChatTranscriptModel } from "./chat-transcript-model";
import { postMessage } from "../utils/llm-utils";
import { DAVAI_SPEAKER, USER_SPEAKER } from "../constants";

jest.mock("../utils/llm-utils", () => ({
  postMessage: jest.fn(),
}));
jest.mock("../utils/local-llm/local-llm-service", () => ({
  localLlmService: {
    isWebGPUAvailable: jest.fn(() => true),
    loadEngine: jest.fn().mockResolvedValue(undefined),
    generate: jest.fn(),
    interrupt: jest.fn(),
    unload: jest.fn().mockResolvedValue(undefined),
    getLoadState: jest.fn(() => ({ status: "ready" })),
    onLoadStateChange: jest.fn(() => () => undefined),
  },
}));
jest.mock("../utils/local-llm/local-llm-loop", () => ({
  runLocalTurn: jest.fn().mockResolvedValue("A local description."),
}));
jest.mock("@concord-consortium/codap-plugin-api", () => ({
  ...jest.requireActual("@concord-consortium/codap-plugin-api"),
  codapInterface: { sendRequest: jest.fn() },
}));

import { localLlmService } from "../utils/local-llm/local-llm-service";
import { runLocalTurn } from "../utils/local-llm/local-llm-loop";
import { codapInterface } from "@concord-consortium/codap-plugin-api";

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

describe("AssistantModel effort (DAVAI-125)", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it("includes the effort in the message request body", async () => {
    const store = createStore();
    store.setEffort("low");
    mockedPostMessage.mockReturnValue(new Promise<Response>(() => { /* never resolves */ })); // park after submit
    store.handleMessageSubmit("hi");
    await Promise.resolve();
    const body = mockedPostMessage.mock.calls[0][0];
    expect(body.effort).toBe("low");
  });
});

describe("AssistantModel isLocalLlm (DAVAI-126)", () => {
  it("isLocalLlm reflects the Local provider in llmId", () => {
    const assistantStore = createStore();
    assistantStore.setLlmId(JSON.stringify({ id: "Qwen3-1.7B-q4f16_1-MLC", provider: "Local" }));
    expect(assistantStore.isLocalLlm).toBe(true);
    assistantStore.setLlmId(JSON.stringify({ id: "mock", provider: "Mock" }));
    expect(assistantStore.isLocalLlm).toBe(false);
  });
});

describe("handleMessageSubmitLocalLlm (DAVAI-126)", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  const createLocalStore = () => {
    const store = createStore();
    store.setLlmId(JSON.stringify({ id: "Qwen3-1.7B-q4f16_1-MLC", provider: "Local" }));
    return store;
  };

  it("runs a local turn and adds the reply to the transcript without any server call", async () => {
    const store = createLocalStore();
    await store.handleMessageSubmitLocalLlm("describe the graph");

    expect(localLlmService.loadEngine).toHaveBeenCalledWith("Qwen3-1.7B-q4f16_1-MLC");
    expect(runLocalTurn).toHaveBeenCalledWith(expect.objectContaining({
      userMessage: "describe the graph",
    }));
    const last = store.transcriptStore.messages.at(-1);
    expect(last?.speaker).toBe(DAVAI_SPEAKER);
    expect(last?.messageContent.content).toBe("A local description.");
    // No server round-trip on the local path.
    expect(mockedPostMessage).not.toHaveBeenCalled();
  });

  it("replies with a WebGPU explanation when WebGPU is unavailable", async () => {
    const store = createLocalStore();
    (localLlmService.isWebGPUAvailable as jest.Mock).mockReturnValueOnce(false);

    await store.handleMessageSubmitLocalLlm("hello");

    const last = store.transcriptStore.messages.at(-1);
    expect(last?.messageContent.content).toMatch(/WebGPU/);
    expect(runLocalTurn).not.toHaveBeenCalled();
    expect(store.isLoadingResponse).toBe(false);
  });

  it("replies with an error message when the local turn throws", async () => {
    const store = createLocalStore();
    (runLocalTurn as jest.Mock).mockRejectedValueOnce(new Error("engine crashed"));

    await store.handleMessageSubmitLocalLlm("hello");

    const last = store.transcriptStore.messages.at(-1);
    expect(last?.messageContent.content).toMatch(/error/i);
    expect(store.isLoadingResponse).toBe(false);
  });

  it("queues a message while a local response is in flight", async () => {
    const store = createLocalStore();
    let release: (v: string) => void = () => undefined;
    (runLocalTurn as jest.Mock).mockImplementationOnce(
      () => new Promise((res) => { release = res; })
    );

    const first = store.handleMessageSubmitLocalLlm("first");
    await Promise.resolve();
    await store.handleMessageSubmitLocalLlm("second");
    expect(store.messageQueue.length).toBe(1);

    release("done with first");
    await first;

    // Drain: the queued message is submitted after the first completes.
    expect((runLocalTurn as jest.Mock).mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("drops a queued message on cancel instead of leaking it to the server", async () => {
    // handleMessageSubmitLocalLlm drains its own queue in its `finally` block (so a queued
    // local message is never routed through the shared afterCreate/onSnapshot reactor, which
    // is hardcoded to the server's handleMessageSubmit). Cancelling bypasses that `finally`
    // entirely, so without an explicit clear here, a still-queued message would fall through
    // to that shared reactor the moment isLoadingResponse flips to false and get sent to the
    // server — defeating "no server request possible on the local path".
    const store = createLocalStore();
    let release: (v: string) => void = () => undefined;
    (runLocalTurn as jest.Mock).mockImplementationOnce(
      () => new Promise((res) => { release = res; })
    );

    const first = store.handleMessageSubmitLocalLlm("first");
    await Promise.resolve();
    await store.handleMessageSubmitLocalLlm("second"); // queued while "first" is in flight
    expect(store.messageQueue.length).toBe(1);

    await store.handleCancel();
    await Promise.resolve();
    await Promise.resolve();

    expect(mockedPostMessage).not.toHaveBeenCalled();
    expect(store.messageQueue.length).toBe(0);

    release("done"); // let the abandoned first turn settle so the test can exit cleanly
    await first.catch(() => undefined);
  });

  it("posts no reply after cancel when the in-flight turn later settles (DAVAI-126 C1)", async () => {
    // Cancel interrupts generation and clears the flags, but the flow suspended at
    // `yield runLocalTurn` still resumes when the (now-abandoned) promise settles. Without an
    // epoch guard, its addDavaiMsg would post a zombie reply AFTER "I've cancelled…", and its
    // finally would clear isLoadingResponse mid-next-turn. The captured epoch must make the
    // resumed flow a no-op.
    const store = createLocalStore();
    let release: (v: string) => void = () => undefined;
    (runLocalTurn as jest.Mock).mockImplementationOnce(
      () => new Promise((res) => { release = res; })
    );

    const first = store.handleMessageSubmitLocalLlm("describe the graph");
    await Promise.resolve();
    expect(store.isLoadingResponse).toBe(true);

    await store.handleCancel();
    expect(store.isLoadingResponse).toBe(false);

    // The abandoned turn settles late (interrupt() typically yields partial/empty text).
    release("A late zombie reply.");
    await first;
    await Promise.resolve();

    const contents = store.transcriptStore.messages.map((m) => m.messageContent.content);
    expect(contents).toContain("I've cancelled processing your message.");
    // The zombie reply must NOT be posted, and no fallback/error zombie either.
    expect(contents).not.toContain("A late zombie reply.");
    expect(contents.filter((c) => c === "I've cancelled processing your message.")).toHaveLength(1);
    // Flags stay cleared — the stale finally did not resurrect loading state.
    expect(store.isLoadingResponse).toBe(false);
    expect(store.showLoadingIndicator).toBe(false);
  });

  it("posts no error zombie when a cancelled turn later rejects (DAVAI-126 C1)", async () => {
    const store = createLocalStore();
    let reject: (e: Error) => void = () => undefined;
    (runLocalTurn as jest.Mock).mockImplementationOnce(
      () => new Promise((_res, rej) => { reject = rej; })
    );

    const first = store.handleMessageSubmitLocalLlm("describe the graph");
    await Promise.resolve();
    await store.handleCancel();

    reject(new Error("interrupted mid-generation"));
    await first.catch(() => undefined);
    await Promise.resolve();

    const contents = store.transcriptStore.messages.map((m) => m.messageContent.content);
    expect(contents).not.toContain("Sorry, I ran into an error running the local model on that request.");
    expect(store.isLoadingResponse).toBe(false);
  });

  it("does not let a cancelled turn's stale finally clobber a fresh turn's loading flag (DAVAI-126 C1)", async () => {
    const store = createLocalStore();
    let releaseFirst: (v: string) => void = () => undefined;
    let releaseSecond: (v: string) => void = () => undefined;
    (runLocalTurn as jest.Mock)
      .mockImplementationOnce(() => new Promise((res) => { releaseFirst = res; }))
      .mockImplementationOnce(() => new Promise((res) => { releaseSecond = res; }));

    const first = store.handleMessageSubmitLocalLlm("first");
    await Promise.resolve();
    await store.handleCancel(); // epoch bumped; first turn abandoned

    // A brand-new turn starts (input was re-enabled by cancel).
    const second = store.handleMessageSubmitLocalLlm("second");
    await Promise.resolve();
    expect(store.isLoadingResponse).toBe(true); // second turn is live

    // Now the abandoned FIRST turn finally settles. Its finally must NOT flip the live
    // second turn's isLoadingResponse to false.
    releaseFirst("late");
    await first;
    await Promise.resolve();
    expect(store.isLoadingResponse).toBe(true); // still busy with the second turn

    releaseSecond("second done");
    await second;
    await Promise.resolve();
    expect(store.isLoadingResponse).toBe(false); // second turn cleared it normally
    const contents = store.transcriptStore.messages.map((m) => m.messageContent.content);
    expect(contents).toContain("second done");
    expect(contents).not.toContain("late");
  });

  it("handles a local create_request tool call with no 'values' without throwing (DAVAI-126 minor)", async () => {
    // The local envelope parser passes through an omitted "values", so processToolCall's
    // graph-create check (values.type === "graph") must not dereference an undefined values.
    const store = createLocalStore();
    (codapInterface.sendRequest as jest.Mock).mockResolvedValueOnce({ success: true, values: {} });
    let toolResult: string | undefined;
    (runLocalTurn as jest.Mock).mockImplementationOnce(async (args: any) => {
      toolResult = await args.executeTool({
        type: "create_request",
        tool_call_id: "local-0",
        request: { action: "create", resource: "component" }, // no `values`
      });
      return "Created.";
    });

    await store.handleMessageSubmitLocalLlm("make a component");

    // The tool executed and returned the CODAP response as a string (graph-create branch was
    // skipped because values is undefined) — no TypeError bubbled up.
    expect(toolResult).toBe(JSON.stringify({ success: true, values: {} }));
    expect(store.transcriptStore.messages.at(-1)?.messageContent.content).toBe("Created.");
  });

  it("assembles a drained queue turn without dropping the prior reply or duplicating the queued text (DAVAI-126 I3)", async () => {
    // Reproduce the transcript state at the moment a queued turn is drained: the queued user
    // message was added by App at submit time, and the PRIOR turn's DAVAI reply is now the last
    // row. slice(0,-1) would wrongly drop that reply and leave the queued text duplicated (in
    // turns AND as userMessage).
    const store = createLocalStore();
    store.transcriptStore.addMessage(USER_SPEAKER, { content: "first question" });
    store.transcriptStore.addMessage(USER_SPEAKER, { content: "second question" }); // queued at submit
    store.addDavaiMsg("Answer to the first question."); // prior turn's reply, now the last row

    (runLocalTurn as jest.Mock).mockResolvedValueOnce("Answer to the second question.");
    // Drain "second question" the way the finally block does (no App-side user-row insertion).
    await store.handleMessageSubmitLocalLlm("second question");

    const args = (runLocalTurn as jest.Mock).mock.calls.at(-1)![0];
    const turnContents = args.turns.map((t: any) => t.content);
    // The prior DAVAI reply is preserved in history, exactly once.
    expect(turnContents).toContain("Answer to the first question.");
    expect(turnContents.filter((c: string) => c === "Answer to the first question.")).toHaveLength(1);
    // The queued text is the userMessage, and does NOT also appear duplicated in the turns.
    expect(args.userMessage).toBe("second question");
    expect(turnContents.filter((c: string) => c === "second question")).toHaveLength(1);
  });

  it("still drops the trailing user row for a direct submit (DAVAI-126 I3)", async () => {
    // Direct submit path: App adds the user row immediately before dispatch, so the last row IS
    // the just-submitted message and must be excluded from the mapped turns.
    const store = createLocalStore();
    store.transcriptStore.addMessage(DAVAI_SPEAKER, { content: "Earlier reply." });
    store.transcriptStore.addMessage(USER_SPEAKER, { content: "describe the graph" }); // App-added

    (runLocalTurn as jest.Mock).mockResolvedValueOnce("A description.");
    await store.handleMessageSubmitLocalLlm("describe the graph");

    const args = (runLocalTurn as jest.Mock).mock.calls.at(-1)![0];
    const turnContents = args.turns.map((t: any) => t.content);
    expect(turnContents).toContain("Earlier reply.");
    // The just-submitted user row is not duplicated into the turns.
    expect(turnContents).not.toContain("describe the graph");
    expect(args.userMessage).toBe("describe the graph");
  });

  it("tags status messages as kind 'announcement' so they stay out of model history (DAVAI-126 I2)", async () => {
    const store = createLocalStore();

    // WebGPU-unavailable notice.
    (localLlmService.isWebGPUAvailable as jest.Mock).mockReturnValueOnce(false);
    await store.handleMessageSubmitLocalLlm("hello");
    const webgpuMsg = store.transcriptStore.messages.at(-1);
    expect(webgpuMsg?.messageContent.kind).toBe("announcement");

    // Local-turn error notice.
    (localLlmService.isWebGPUAvailable as jest.Mock).mockReturnValue(true);
    (runLocalTurn as jest.Mock).mockRejectedValueOnce(new Error("engine crashed"));
    await store.handleMessageSubmitLocalLlm("again");
    const errorMsg = store.transcriptStore.messages.at(-1);
    expect(errorMsg?.messageContent.content).toMatch(/error/i);
    expect(errorMsg?.messageContent.kind).toBe("announcement");

    // A real reply is NOT an announcement (so it still feeds model history).
    (runLocalTurn as jest.Mock).mockResolvedValueOnce("A real description.");
    await store.handleMessageSubmitLocalLlm("once more");
    const replyMsg = store.transcriptStore.messages.at(-1);
    expect(replyMsg?.messageContent.content).toBe("A real description.");
    expect(replyMsg?.messageContent.kind).toBeUndefined();
  });

  it("tags the local cancel confirmation as an announcement (DAVAI-126 I2)", async () => {
    const store = createLocalStore();
    let release: (v: string) => void = () => undefined;
    (runLocalTurn as jest.Mock).mockImplementationOnce(() => new Promise((res) => { release = res; }));
    const first = store.handleMessageSubmitLocalLlm("describe the graph");
    await Promise.resolve();
    await store.handleCancel();
    const cancelMsg = store.transcriptStore.messages.at(-1);
    expect(cancelMsg?.messageContent.content).toBe("I've cancelled processing your message.");
    expect(cancelMsg?.messageContent.kind).toBe("announcement");
    release("late");
    await first.catch(() => undefined);
  });

  it("discards an in-flight local turn when the model is switched mid-turn (DAVAI-126 C1)", async () => {
    // Switching models (setLlmId) bumps the same epoch as cancel, so a turn started under the
    // old model must not post its reply into the new model's conversation.
    const store = createLocalStore();
    let release: (v: string) => void = () => undefined;
    (runLocalTurn as jest.Mock).mockImplementationOnce(
      () => new Promise((res) => { release = res; })
    );

    const first = store.handleMessageSubmitLocalLlm("describe the graph");
    await Promise.resolve();

    store.setLlmId(JSON.stringify({ id: "Qwen3-4B-q4f16_1-MLC", provider: "Local" }));

    release("stale reply from the old model");
    await first;
    await Promise.resolve();

    const contents = store.transcriptStore.messages.map((m) => m.messageContent.content);
    expect(contents).not.toContain("stale reply from the old model");
  });
});
