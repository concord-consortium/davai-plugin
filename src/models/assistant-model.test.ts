import { types } from "mobx-state-tree";
import { AssistantModel } from "./assistant-model";
import { ChatTranscriptModel } from "./chat-transcript-model";
import { GraphSonificationModel } from "./graph-sonification-model";
import { postMessage } from "../utils/llm-utils";
import { DAVAI_SPEAKER, USER_SPEAKER } from "../constants";

jest.mock("../utils/llm-utils", () => ({
  postMessage: jest.fn(),
}));
jest.mock("../utils/ws-transport", () => ({
  WsTransport: jest.fn().mockImplementation(() => ({
    // Never resolves: a submitted turn stays "in flight" so cancel paths can be exercised.
    runTurn: jest.fn(() => new Promise(() => { /* never resolves */ })),
    cancel: jest.fn(),
    close: jest.fn(),
  })),
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
jest.mock("../utils/local-llm/tools", () => ({
  initializeLocalTools: jest.fn(),
  dispatchTool: jest.fn().mockResolvedValue("tool ok"),
  buildToolDocs: jest.fn(() => "- docs"),
}));
jest.mock("../utils/local-llm/local-llm-prefetch", () => ({
  buildGraphSeed: jest.fn().mockResolvedValue(""),
  buildSchemaDigest: jest.fn(() => "digest"),
  // Real passthrough (not a stub): the current-graph derivation is exactly what these tests
  // (and the eval fixture guard's single-graph fix) exercise assistant-model's wiring OF.
  deriveCurrentGraphId: jest.requireActual("../utils/local-llm/local-llm-prefetch").deriveCurrentGraphId,
}));
jest.mock("@concord-consortium/codap-plugin-api", () => ({
  ...jest.requireActual("@concord-consortium/codap-plugin-api"),
  codapInterface: { sendRequest: jest.fn() },
}));
jest.mock("../utils/codap-api-utils", () => ({
  ...jest.requireActual("../utils/codap-api-utils"),
  getTrimmedGraphDetails: jest.fn().mockResolvedValue([]),
  // Backs the sonification store's OWN setGraphs (graph-sonification-model.ts), which the local
  // create_graph tool's refreshGraphs wiring must trigger — separate from getTrimmedGraphDetails
  // above, which only backs the assistant's own graph list (self.graphs, for name resolution).
  getGraphDetails: jest.fn().mockResolvedValue([]),
}));

import { codapInterface } from "@concord-consortium/codap-plugin-api";
import { localLlmService } from "../utils/local-llm/local-llm-service";
import { WsTransport } from "../utils/ws-transport";
import { runLocalTurn } from "../utils/local-llm/local-llm-loop";
import { dispatchTool } from "../utils/local-llm/tools";
import { buildSchemaDigest, buildGraphSeed } from "../utils/local-llm/local-llm-prefetch";
import { getTrimmedGraphDetails, getGraphDetails } from "../utils/codap-api-utils";

const mockedPostMessage = postMessage as jest.MockedFunction<typeof postMessage>;

const createStore = () => {
  const transcriptStore = ChatTranscriptModel.create({ messages: [] });
  return AssistantModel.create({ transcriptStore, threadId: "thread-1" });
};

describe("AssistantModel streaming busy-state", () => {
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

describe("AssistantModel effort", () => {
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

describe("AssistantModel isLocalLlm", () => {
  it("isLocalLlm reflects the Local provider in llmId", () => {
    const assistantStore = createStore();
    assistantStore.setLlmId(JSON.stringify({ id: "Qwen3-1.7B-q4f16_1-MLC", provider: "Local" }));
    expect(assistantStore.isLocalLlm).toBe(true);
    assistantStore.setLlmId(JSON.stringify({ id: "mock", provider: "Mock" }));
    expect(assistantStore.isLocalLlm).toBe(false);
  });
});

describe("handleMessageSubmitLocalLlm", () => {
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

  it("createThread (reset) also drops a queued local message instead of leaking it to the server", async () => {
    // createThread already bumps turnEpoch (invalidating the in-flight local turn — it has no
    // currentMessageId to gate the handleCancel branch above, since only the SERVER path sets
    // that). It must also clear messageQueue, the way handleCancel and setLlmId both do: a queued
    // local message would otherwise survive the reset and fall through to the shared
    // afterCreate/onSnapshot reactor (hardcoded to the server's handleMessageSubmit) the moment
    // isLoadingResponse flips to false, leaking a local-turn message to the server path.
    const store = createLocalStore();
    let release: (v: string) => void = () => undefined;
    (runLocalTurn as jest.Mock).mockImplementationOnce(
      () => new Promise((res) => { release = res; })
    );

    const first = store.handleMessageSubmitLocalLlm("first");
    await Promise.resolve();
    await store.handleMessageSubmitLocalLlm("second"); // queued while "first" is in flight
    expect(store.messageQueue.length).toBe(1);

    await store.createThread();
    await Promise.resolve();
    await Promise.resolve();

    expect(mockedPostMessage).not.toHaveBeenCalled();
    expect(store.messageQueue.length).toBe(0);

    release("done"); // let the abandoned first turn settle so the test can exit cleanly
    await first.catch(() => undefined);
  });

  it("discards a WS result that arrives after cancel (cancel frame lost the race)", async () => {
    // The server's abort is only checked between stream chunks, and the cancel frame
    // races the result frame across the AgentCore hop. When the REAL result arrives
    // after handleCancel, the suspended turn must discard it — not render it.
    const store = createStore();
    store.setUseWebSocket(true);
    let release: (v: any) => void = () => undefined;
    (WsTransport as jest.Mock).mockImplementationOnce(() => ({
      runTurn: jest.fn(() => new Promise((res) => { release = res; })),
      cancel: jest.fn(),
      close: jest.fn(),
    }));

    const turn = store.handleMessageSubmit("write a long essay");
    await Promise.resolve();
    expect(store.isLoadingResponse).toBe(true);

    await store.handleCancel();

    release({ response: "A late zombie response." });
    await turn;

    const contents = store.transcriptStore.messages.map((m) => m.messageContent.content);
    expect(contents).toContain("I've cancelled processing your message.");
    expect(contents).not.toContain("A late zombie response.");
  });

  it("does not execute a tool call from a WS result that arrives after cancel", async () => {
    const store = createStore();
    store.setUseWebSocket(true);
    let release: (v: any) => void = () => undefined;
    (WsTransport as jest.Mock).mockImplementationOnce(() => ({
      runTurn: jest.fn(() => new Promise((res) => { release = res; })),
      cancel: jest.fn(),
      close: jest.fn(),
    }));

    const turn = store.handleMessageSubmit("make a scatterplot");
    await Promise.resolve();
    await store.handleCancel();

    // Late requires_action: without the latch this would run the CODAP request
    // ("the graph appears seconds after cancelling").
    release({
      status: "requires_action",
      tool_call_id: "call-1",
      request: { action: "create", resource: "component", values: { type: "graph" } },
    });
    await turn;

    expect((codapInterface.sendRequest as jest.Mock)).not.toHaveBeenCalled();
  });

  it("posts no reply after cancel when the in-flight turn later settles", async () => {
    // Cancel interrupts generation and clears the flags, but the flow suspended at
    // `yield runLocalTurn` still resumes when that promise settles. Without an
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
    // Guards against a stale cleanup callback resurrecting loading state after cancel.
    expect(store.isLoadingResponse).toBe(false);
    expect(store.showLoadingIndicator).toBe(false);
  });

  it("posts no error zombie when a cancelled turn later rejects", async () => {
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

  it("does not let a cancelled turn's stale finally clobber a fresh turn's loading flag", async () => {
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

  it("lets the local executor invoke the tool registry across a macrotask boundary without an MST parent-context error", async () => {
    // Regression test for "a mst flow must always have a parent context": in the real browser,
    // runLocalTurn's executeTool callback is invoked from an async continuation that has crossed
    // a real task boundary (e.g. after awaiting model generation), so it does NOT inherit an MST
    // action context from the outer `yield runLocalTurn(...)` call. The `await new Promise(...,
    // setTimeout)` below reproduces that macrotask hop — calling executeTool synchronously inside
    // the mock (as other tests in this file do) does not exercise the bug, because it stays
    // within the same microtask chain and happens to still inherit the parent context. The tool
    // context passed to dispatchTool is built from plain utilities and REGISTERED actions only
    // (never a bare flow closure), so it survives being invoked from that async continuation.
    const store = createLocalStore();

    (runLocalTurn as jest.Mock).mockImplementationOnce(async (args: any) => {
      await new Promise((res) => setTimeout(res, 0));
      const result = await args.executeTool("get_graph_info", {});
      return `Result: ${result}`;
    });

    await store.handleMessageSubmitLocalLlm("list the components");

    expect(dispatchTool).toHaveBeenCalledWith("get_graph_info", {}, expect.anything());
    const contents = store.transcriptStore.messages.map((m) => m.messageContent.content);
    expect(contents).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/error running the local model/i)])
    );
    expect(contents.some((c) => typeof c === "string" && /mst flow must always have a parent context/i.test(c)))
      .toBe(false);
    expect(store.transcriptStore.messages.at(-1)?.messageContent.content).toBe("Result: tool ok");
  });

  it("assembles a drained queue turn without dropping the prior reply or duplicating the queued text", async () => {
    // Reproduce the transcript state at the moment a queued turn is drained: the queued user
    // message was added by App at submit time, and the PRIOR turn's DAVAI reply is the last
    // row (not the queued user row) — trailing-only removal leaves the queued row in place, so
    // it stays in `turns` AND repeats as `userMessage`. Removal must instead find the LAST
    // occurrence of a USER_SPEAKER row matching messageText, wherever it sits.
    const store = createLocalStore();
    store.transcriptStore.addMessage(USER_SPEAKER, { content: "first question" });
    store.transcriptStore.addMessage(USER_SPEAKER, { content: "second question" }); // queued at submit
    store.addDavaiMsg("Answer to the first question."); // prior turn's reply, now the last row

    (runLocalTurn as jest.Mock).mockResolvedValueOnce("Answer to the second question.");
    // Drain "second question" the way the finally block does (no App-side user-row insertion).
    await store.handleMessageSubmitLocalLlm("second question");

    const args = (runLocalTurn as jest.Mock).mock.calls.at(-1)![0];
    // Exact shape: turns = [user1 -> assistant answer1]. The queued row is fully absent from
    // turns (not merely "present once amid other duplicates") and appears exactly once overall,
    // as userMessage.
    expect(args.turns).toEqual([
      { role: "user", content: "first question" },
      { role: "assistant", content: "Answer to the first question." },
    ]);
    expect(args.userMessage).toBe("second question");
  });

  it("still drops the trailing user row for a direct submit", async () => {
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

  it("keeps an earlier identical user question when removing only the last-occurring queued row", async () => {
    // A history where the SAME question text was asked earlier (and answered differently) must
    // keep that earlier row intact — only the most recent (queued) occurrence is the one being
    // drained and must be excluded from `turns`.
    const store = createLocalStore();
    store.transcriptStore.addMessage(USER_SPEAKER, { content: "describe the graph" }); // earlier, legitimate
    store.addDavaiMsg("First description.");
    store.transcriptStore.addMessage(USER_SPEAKER, { content: "describe the graph" }); // queued at submit (duplicate text)

    (runLocalTurn as jest.Mock).mockResolvedValueOnce("Second description.");
    await store.handleMessageSubmitLocalLlm("describe the graph");

    const args = (runLocalTurn as jest.Mock).mock.calls.at(-1)![0];
    // The earlier identical question survives in turns, exactly once, paired with its own reply.
    expect(args.turns).toEqual([
      { role: "user", content: "describe the graph" },
      { role: "assistant", content: "First description." },
    ]);
    expect(args.userMessage).toBe("describe the graph");
  });

  it("tags status messages as kind 'announcement' so they stay out of model history", async () => {
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

  it("tags the local cancel confirmation as an announcement", async () => {
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

  it("discards an in-flight local turn when the model is switched mid-turn", async () => {
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

  it("clears the busy flags and message queue immediately when the model is switched mid-turn", async () => {
    // The epoch design intentionally makes a STALE turn's finally skip clearing the flags (so it
    // can't clobber a NEWER turn — see "does not let a cancelled turn's stale finally clobber a
    // fresh turn's loading flag" above). But a model switch creates no newer turn to eventually
    // clear them: nothing else will ever flip isLoadingResponse/showLoadingIndicator back to
    // false, so the chat input would stay disabled forever unless setLlmId clears them itself,
    // the same way handleCancel's local branch does.
    const store = createLocalStore();
    let release: (v: string) => void = () => undefined;
    (runLocalTurn as jest.Mock).mockImplementationOnce(
      () => new Promise((res) => { release = res; })
    );

    const first = store.handleMessageSubmitLocalLlm("describe the graph");
    await Promise.resolve();
    expect(store.isLoadingResponse).toBe(true);

    // A message queued behind the in-flight turn: switching models invalidates the transcript
    // context it would have run against, so it must be dropped too (mirrors handleCancel).
    const queued = store.handleMessageSubmitLocalLlm("queued before switch");
    await Promise.resolve();
    expect(store.messageQueue.length).toBe(1);

    store.setLlmId(JSON.stringify({ id: "Qwen3-4B-q4f16_1-MLC", provider: "Local" }));

    // Cleared immediately by the switch itself — no need to wait for the stale turn to settle.
    expect(store.isLoadingResponse).toBe(false);
    expect(store.showLoadingIndicator).toBe(false);
    expect(store.messageQueue.length).toBe(0);

    // The stale turn resuming afterward must not re-set the flags or post anything (existing
    // epoch semantics).
    release("stale reply from the old model");
    await first;
    await queued;
    await Promise.resolve();

    expect(store.isLoadingResponse).toBe(false);
    expect(store.showLoadingIndicator).toBe(false);
    const contents = store.transcriptStore.messages.map((m) => m.messageContent.content);
    expect(contents).not.toContain("stale reply from the old model");
  });

  it("still clears the busy flags normally when a turn completes without a model switch", async () => {
    // setLlmId's flag-clearing addition must only affect an ACTUAL switch (a real epoch bump);
    // an ordinary completed turn (no switch involved) must clear the flags via its own finally,
    // independent of setLlmId.
    const store = createLocalStore();
    await store.handleMessageSubmitLocalLlm("describe the graph");

    expect(store.isLoadingResponse).toBe(false);
    expect(store.showLoadingIndicator).toBe(false);
    const last = store.transcriptStore.messages.at(-1);
    expect(last?.messageContent.content).toBe("A local description.");
  });

  it("setting the SAME llmId does not clear busy flags or the queue (no-op switch)", async () => {
    // setLlmId only bumps the epoch (and clears the flags/queue) on a REAL change. Calling it
    // with the value it already has must not interrupt an in-flight turn.
    const store = createLocalStore();
    let release: (v: string) => void = () => undefined;
    (runLocalTurn as jest.Mock).mockImplementationOnce(
      () => new Promise((res) => { release = res; })
    );

    const first = store.handleMessageSubmitLocalLlm("describe the graph");
    await Promise.resolve();
    expect(store.isLoadingResponse).toBe(true);

    store.setLlmId(store.llmId); // same value: not a switch

    expect(store.isLoadingResponse).toBe(true); // untouched

    release("real reply");
    await first;
    await Promise.resolve();

    expect(store.isLoadingResponse).toBe(false);
    const contents = store.transcriptStore.messages.map((m) => m.messageContent.content);
    expect(contents).toContain("real reply");
  });

  describe("thinking toggle", () => {
    // buildLocalSystemPrompt/local-llm-prompt is NOT mocked in this file, so the systemPrompt
    // runLocalTurn receives is the REAL assembled prompt — its trailing /think or /no_think
    // switch is a direct, faithful signal of what `thinking` was passed in as.
    it("effort 'think' builds the prompt with thinking:true (ends with /think) and calls " +
      "generate with maxTokens 2048", async () => {
        const store = createLocalStore();
        store.setEffort("think");
        await store.handleMessageSubmitLocalLlm("describe the graph");

        const args = (runLocalTurn as jest.Mock).mock.calls.at(-1)![0];
        expect(args.systemPrompt.trimEnd().endsWith("/think")).toBe(true);

        (localLlmService.generate as jest.Mock).mockClear();
        await args.generate([{ role: "user", content: "hi" }]);
        expect(localLlmService.generate).toHaveBeenCalledWith(
          [{ role: "user", content: "hi" }], { maxTokens: 2048 }
        );
      });

    it("effort '' (none/default) builds the prompt with thinking:false (ends with /no_think) " +
      "and calls generate with maxTokens 1024", async () => {
        const store = createLocalStore();
        store.setEffort("");
        await store.handleMessageSubmitLocalLlm("describe the graph");

        const args = (runLocalTurn as jest.Mock).mock.calls.at(-1)![0];
        expect(args.systemPrompt.trimEnd().endsWith("/no_think")).toBe(true);

        (localLlmService.generate as jest.Mock).mockClear();
        await args.generate([{ role: "user", content: "hi" }]);
        expect(localLlmService.generate).toHaveBeenCalledWith(
          [{ role: "user", content: "hi" }], { maxTokens: 1024 }
        );
      });
  });

  describe("current-graph derivation: single-graph documents need no manual " +
    "sonification selection", () => {
    it("builds the graph seed for the sole graph even with no sonification-store selection " +
      "(this bare store's getRoot(self) has no sonificationStore, i.e. no explicit selection)", async () => {
      const store = createLocalStore();
      (getTrimmedGraphDetails as jest.Mock).mockResolvedValueOnce([{ id: 55, name: "Heights" }]);
      await store.updateGraphs();

      await store.handleMessageSubmitLocalLlm("describe the graph");

      expect(buildGraphSeed).toHaveBeenCalledWith("55", expect.anything());
    });

    it("does not build a graph seed when there are zero graphs and nothing is selected", async () => {
      const store = createLocalStore();
      // self.graphs defaults to null (no updateGraphs call) — zero graphs, nothing selected.
      await store.handleMessageSubmitLocalLlm("hello");

      expect(buildGraphSeed).not.toHaveBeenCalled();
    });
  });

  describe("response-time debug entries (local-turn parity with the server path)", () => {
    // timingDebug posts an ELAPSED duration from responseStartTime, so a Begin posted at submit
    // would always read 0. The local turn is non-streamed (no "first chunk" moment), so — like
    // finalizeStream's non-streamed branch on the server path — the Begin/Completed pair posts
    // together at completion, begin == completed.
    const timingRows = (store: { transcriptStore: { messages: { messageContent: { description?: string } }[] } }) =>
      store.transcriptStore.messages.filter(
        (m) => m.messageContent.description === "Begin response time" ||
               m.messageContent.description === "Completed response time"
      );

    it("posts no timing entry at submit; emits Begin AND Completed together at completion, in " +
      "that order, on a successful turn", async () => {
      const store = createLocalStore();
      let release: (v: string) => void = () => undefined;
      (runLocalTurn as jest.Mock).mockImplementationOnce(
        () => new Promise((res) => { release = res; })
      );

      const turn = store.handleMessageSubmitLocalLlm("describe the graph");
      await Promise.resolve();

      // Nothing while the turn is in flight — a submit-time Begin would always read 0 elapsed.
      expect(timingRows(store)).toHaveLength(0);

      release("A local description.");
      await turn;

      const messages = store.transcriptStore.messages;
      const beginIndex = messages.findIndex((m) => m.messageContent.description === "Begin response time");
      const completedIndex = messages.findIndex((m) => m.messageContent.description === "Completed response time");
      expect(beginIndex).toBeGreaterThanOrEqual(0);
      expect(completedIndex).toBeGreaterThanOrEqual(0);
      expect(beginIndex).toBeLessThan(completedIndex);
      // Exactly one of each: the pair posts once, at completion.
      expect(timingRows(store)).toHaveLength(2);
    });

    it("posts the Begin/Completed pair BEFORE the DAVAI reply, keeping the reply as the last " +
      "transcript row (mirrors finalizeStream's non-streamed ordering on the server path — " +
      "App's announce/speak effect keys off 'last message is a DAVAI message')", async () => {
      const store = createLocalStore();
      await store.handleMessageSubmitLocalLlm("describe the graph");

      const messages = store.transcriptStore.messages;
      const replyIndex = messages.findIndex(
        (m) => m.speaker === DAVAI_SPEAKER && m.messageContent.content === "A local description."
      );
      const beginIndex = messages.findIndex((m) => m.messageContent.description === "Begin response time");
      const completedIndex = messages.findIndex((m) => m.messageContent.description === "Completed response time");
      expect(replyIndex).toBeGreaterThanOrEqual(0);
      expect(beginIndex).toBeGreaterThanOrEqual(0);
      expect(completedIndex).toBeGreaterThanOrEqual(0);
      expect(beginIndex).toBeLessThan(completedIndex);
      expect(completedIndex).toBeLessThan(replyIndex);
      expect(messages.at(-1)?.speaker).toBe(DAVAI_SPEAKER);
    });

    it("posts no timing entry at submit and emits the Begin/Completed pair, in order, at " +
      "completion on the error path too (elapsed-to-failure answers 'how long did it take')", async () => {
      const store = createLocalStore();
      let reject: (e: Error) => void = () => undefined;
      (runLocalTurn as jest.Mock).mockImplementationOnce(
        () => new Promise((_res, rej) => { reject = rej; })
      );

      const turn = store.handleMessageSubmitLocalLlm("hello");
      await Promise.resolve();

      expect(timingRows(store)).toHaveLength(0);

      reject(new Error("engine crashed"));
      await turn;

      const messages = store.transcriptStore.messages;
      const beginIndex = messages.findIndex((m) => m.messageContent.description === "Begin response time");
      const completedIndex = messages.findIndex((m) => m.messageContent.description === "Completed response time");
      expect(beginIndex).toBeGreaterThanOrEqual(0);
      expect(completedIndex).toBeGreaterThanOrEqual(0);
      expect(beginIndex).toBeLessThan(completedIndex);
      expect(timingRows(store)).toHaveLength(2);
    });

    it("reports the SAME full elapsed duration on Begin and Completed (begin == completed), " +
      "consistent with performance.now() deltas — a submit-time Begin would read 0.00 s", async () => {
      const store = createLocalStore();
      let now = 1_000;
      const nowSpy = jest.spyOn(performance, "now").mockImplementation(() => now);
      (runLocalTurn as jest.Mock).mockImplementationOnce(async () => {
        now += 4_230; // simulate 4.23s of local-model work
        return "A local description.";
      });

      await store.handleMessageSubmitLocalLlm("describe the graph");

      const begin = store.transcriptStore.messages.find(
        (m) => m.messageContent.description === "Begin response time"
      );
      const completed = store.transcriptStore.messages.find(
        (m) => m.messageContent.description === "Completed response time"
      );
      expect(begin?.messageContent.content).toBe("4.23 s");
      expect(completed?.messageContent.content).toBe("4.23 s");

      nowSpy.mockRestore();
    });

    it("emits neither entry for a stale/cancelled turn (the pair posts only at completion, under " +
      "the same isCurrent() guard, so a stale resumption posts nothing)", async () => {
      // The epoch guard must prevent the STALE resumption (after cancel bumps the epoch) from
      // posting a late Begin/Completed pair once the abandoned runLocalTurn promise settles —
      // and since nothing posts at submit, the cancelled turn leaves NO timing rows.
      const store = createLocalStore();
      let release: (v: string) => void = () => undefined;
      (runLocalTurn as jest.Mock).mockImplementationOnce(
        () => new Promise((res) => { release = res; })
      );

      const first = store.handleMessageSubmitLocalLlm("describe the graph");
      await Promise.resolve();
      await store.handleCancel();

      expect(timingRows(store)).toHaveLength(0);

      release("A late zombie reply.");
      await first;
      await Promise.resolve();

      expect(timingRows(store)).toHaveLength(0);
    });
  });
});

describe("runLocalEvalTurns", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  // A minimal parent combining just the two stores runLocalEvalTurns reads off getRoot(self) —
  // mirrors graph-sonification-model.test.ts's own local test-double RootStore. Deliberately NOT
  // the real RootStore (root-store.ts): that one also carries a volatile TransportManager, whose
  // constructor calls real Tone.js APIs the __mocks__/tone.js stub doesn't implement.
  const TestRootStore = types.model("TestRootStore", {
    assistantStore: AssistantModel,
    sonificationStore: GraphSonificationModel,
  });

  // runLocalEvalTurns' fixture-guard checks root.sonificationStore's selectedGraphID before
  // running the battery, so the store needs a real parent for that guard to see a selection.
  // `selectedGraphID` defaults to 1 (a graph selected) so the many existing tests below — whose
  // whole point is exercising the battery — clear the guard by default; pass `null` for the
  // guard's own dedicated "nothing selected" tests (NOT `undefined`: this is a default PARAMETER,
  // so an explicit `undefined` argument would substitute the default itself rather than opting
  // out of it — `null` is translated to "omit the key" for the MST snapshot, whose own
  // selectedGraphID field is `types.maybe(types.number)`, i.e. unset is `undefined`). `graphs`
  // seeds self.graphs (used by the current-graph-derivation's single-graph fallback) via the
  // real updateGraphs action, mirroring how the app populates it — rather than poking the
  // volatile field directly, which MST's strict mode forbids outside an action.
  const createLocalStore = async (selectedGraphID: number | null = 1, graphs: any[] = []) => {
    const transcriptStore = ChatTranscriptModel.create({ messages: [] });
    const root = TestRootStore.create({
      assistantStore: { transcriptStore, threadId: "thread-1" },
      sonificationStore: {
        allGraphs: {},
        selectedGraphID: selectedGraphID ?? undefined,
        binValues: {},
      },
    });
    const store = root.assistantStore;
    store.setLlmId(JSON.stringify({ id: "Qwen3-1.7B-q4f16_1-MLC", provider: "Local" }));
    (getTrimmedGraphDetails as jest.Mock).mockResolvedValueOnce(graphs);
    await store.updateGraphs();
    return store;
  };

  // Two tiny cases so assertions can pin exact pass/fail counts without depending on the
  // real 11-case eval-cases.ts fixture content.
  const twoCases = [
    { id: "case-a", prompt: "describe", expectTools: { none: true }, expectFinal: { matches: [/A local description/] } },
    { id: "case-b", prompt: "mean?", expectTools: { contains: ["get_stats"] }, expectFinal: { matches: [/mean/i] } },
  ];

  it("runs each case through the local building blocks and posts a start announcement then a summary", async () => {
    const store = await createLocalStore();
    const consoleLogSpy = jest.spyOn(console, "log").mockImplementation(() => undefined);

    await store.runLocalEvalTurns(twoCases as any);

    expect(localLlmService.loadEngine).toHaveBeenCalledWith("Qwen3-1.7B-q4f16_1-MLC");
    // Once per case (no shared/growing conversation across eval cases).
    expect(runLocalTurn).toHaveBeenCalledTimes(2);
    expect(runLocalTurn).toHaveBeenCalledWith(expect.objectContaining({ userMessage: "describe" }));
    expect(runLocalTurn).toHaveBeenCalledWith(expect.objectContaining({ userMessage: "mean?" }));

    const contents = store.transcriptStore.messages.map((m) => m.messageContent.content);
    // A start announcement precedes the completion summary.
    expect(contents.some((c) => typeof c === "string" && /eval/i.test(c) && contents.indexOf(c) < contents.length - 1))
      .toBe(true);
    // case-a passes (no tools expected, runLocalTurn's mock reply matches); case-b fails (mocked
    // reply never calls get_stats), so summarizeEval should read 1/2.
    const summary = contents.at(-1);
    expect(summary).toContain("1/2 passed");
    expect(store.transcriptStore.messages.at(-1)?.messageContent.kind).toBe("announcement");

    // The JSON results dump goes to the console, not the transcript.
    expect(consoleLogSpy).toHaveBeenCalledWith("DAVAI local eval results", expect.stringContaining("case-a"));
    const loggedJson = consoleLogSpy.mock.calls.find((c) => c[0] === "DAVAI local eval results")?.[1];
    expect(() => JSON.parse(loggedJson)).not.toThrow();
    const parsed = JSON.parse(loggedJson);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].id).toBe("case-a");
    expect(parsed[0].passed).toBe(true);
    expect(parsed[1].id).toBe("case-b");
    expect(parsed[1].passed).toBe(false);

    consoleLogSpy.mockRestore();
  });

  // Per-case incremental console output: MST axis-death spam and insertBefore errors interleave
  // with the battery, and the user cannot attribute them to a specific case without a
  // BEFORE/AFTER marker.
  it("logs a BEFORE marker before each case and an AFTER marker with its result, interleaved in " +
    "case order, alongside the existing unchanged final full-array log", async () => {
    const store = await createLocalStore();
    const consoleLogSpy = jest.spyOn(console, "log").mockImplementation(() => undefined);

    await store.runLocalEvalTurns(twoCases as any);

    const caseLogCalls = consoleLogSpy.mock.calls.filter((c) => typeof c[0] === "string" && c[0].startsWith("DAVAI eval case"));
    expect(caseLogCalls).toHaveLength(2);
    expect(caseLogCalls[0][0]).toBe("DAVAI eval case 1/2: case-a — describe");
    expect(caseLogCalls[1][0]).toBe("DAVAI eval case 2/2: case-b — mean?");

    const resultLogCalls = consoleLogSpy.mock.calls.filter((c) => c[0] === "DAVAI eval result");
    expect(resultLogCalls).toHaveLength(2);
    const firstResult = JSON.parse(resultLogCalls[0][1]);
    expect(firstResult.id).toBe("case-a");
    const secondResult = JSON.parse(resultLogCalls[1][1]);
    expect(secondResult.id).toBe("case-b");

    // Interleaving: case-a's BEFORE/AFTER pair fully precedes case-b's own pair.
    const allCalls = consoleLogSpy.mock.calls.map((c) => c[0]);
    const beforeAIdx = allCalls.indexOf("DAVAI eval case 1/2: case-a — describe");
    const afterAIdx = allCalls.findIndex((label, i) => label === "DAVAI eval result" && i > beforeAIdx);
    const beforeBIdx = allCalls.indexOf("DAVAI eval case 2/2: case-b — mean?");
    expect(beforeAIdx).toBeGreaterThanOrEqual(0);
    expect(afterAIdx).toBeGreaterThan(beforeAIdx);
    expect(beforeBIdx).toBeGreaterThan(afterAIdx);

    // The existing final full-array log still fires once, after the per-case logs.
    expect(consoleLogSpy).toHaveBeenCalledWith("DAVAI local eval results", expect.stringContaining("case-a"));

    consoleLogSpy.mockRestore();
  });

  it("bypasses the transcript for individual case turns (only the start announcement and final summary are posted)", async () => {
    const store = await createLocalStore();
    jest.spyOn(console, "log").mockImplementation(() => undefined);

    await store.runLocalEvalTurns(twoCases as any);

    // Exactly two DAVAI-authored rows: the start announcement and the completion summary.
    // No per-case chatter (e.g. "A local description.") leaks into the visible transcript.
    const davaiContents = store.transcriptStore.messages
      .filter((m) => m.speaker === DAVAI_SPEAKER)
      .map((m) => m.messageContent.content);
    expect(davaiContents).toHaveLength(2);
    expect(davaiContents.every((c) => typeof c === "string" && !/^A local description\.$/.test(c))).toBe(true);

    // eslint-disable-next-line no-console
    (console.log as jest.Mock).mockRestore();
  });

  it("records the onToolCall sequence per case into the eval results", async () => {
    const store = await createLocalStore();
    const consoleLogSpy = jest.spyOn(console, "log").mockImplementation(() => undefined);
    // Case-b's turn calls a tool via the onToolCall recorder before returning its final text.
    (runLocalTurn as jest.Mock)
      .mockImplementationOnce(async () => "A local description.") // case-a: no tool calls
      .mockImplementationOnce(async (args: any) => {
        args.onToolCall?.("get_stats");
        return "The mean is 11.";
      });

    await store.runLocalEvalTurns(twoCases as any);

    const loggedJson = consoleLogSpy.mock.calls.find((c) => c[0] === "DAVAI local eval results")?.[1];
    const parsed = JSON.parse(loggedJson);
    expect(parsed[0].toolCalls).toEqual([]);
    expect(parsed[1].toolCalls).toEqual(["get_stats"]);
    expect(parsed[1].passed).toBe(true); // get_stats called + "mean" in the final text

    consoleLogSpy.mockRestore();
  });

  it("records executeTool's result strings in call order into the eval result's toolResults", async () => {
    const store = await createLocalStore();
    const consoleLogSpy = jest.spyOn(console, "log").mockImplementation(() => undefined);
    (dispatchTool as jest.Mock)
      .mockResolvedValueOnce("The mean is 11.")
      .mockResolvedValueOnce("Values: 10, 12, 14.");
    (runLocalTurn as jest.Mock).mockImplementationOnce(async (args: any) => {
      await args.executeTool("get_stats", {});
      await args.executeTool("get_case_values", {});
      return "The mean is 11 and the values are 10, 12, 14.";
    });

    await store.runLocalEvalTurns([twoCases[1]] as any);

    const loggedJson = consoleLogSpy.mock.calls.find((c) => c[0] === "DAVAI local eval results")?.[1];
    const parsed = JSON.parse(loggedJson);
    expect(parsed[0].toolResults).toEqual(["The mean is 11.", "Values: 10, 12, 14."]);

    consoleLogSpy.mockRestore();
  });

  it("truncates a recorded tool result to 300 chars", async () => {
    const store = await createLocalStore();
    const consoleLogSpy = jest.spyOn(console, "log").mockImplementation(() => undefined);
    const longResult = "y".repeat(500);
    (dispatchTool as jest.Mock).mockResolvedValueOnce(longResult);
    (runLocalTurn as jest.Mock).mockImplementationOnce(async (args: any) => {
      await args.executeTool("get_stats", {});
      return "The mean is 11.";
    });

    await store.runLocalEvalTurns([twoCases[1]] as any);

    const loggedJson = consoleLogSpy.mock.calls.find((c) => c[0] === "DAVAI local eval results")?.[1];
    const parsed = JSON.parse(loggedJson);
    expect(parsed[0].toolResults[0]).toHaveLength(300);

    consoleLogSpy.mockRestore();
  });

  it("keeps whatever toolResults were recorded before a case's turn rejects", async () => {
    const store = await createLocalStore();
    const consoleLogSpy = jest.spyOn(console, "log").mockImplementation(() => undefined);
    (dispatchTool as jest.Mock).mockResolvedValueOnce("The mean is 11.");
    (runLocalTurn as jest.Mock).mockImplementationOnce(async (args: any) => {
      await args.executeTool("get_stats", {});
      throw new Error("engine died mid-turn");
    });

    await store.runLocalEvalTurns([twoCases[1]] as any);

    const loggedJson = consoleLogSpy.mock.calls.find((c) => c[0] === "DAVAI local eval results")?.[1];
    const parsed = JSON.parse(loggedJson);
    expect(parsed[0].passed).toBe(false);
    expect(parsed[0].toolResults).toEqual(["The mean is 11."]);

    consoleLogSpy.mockRestore();
  });

  it("reuses the ctx/seed/prompt building blocks exactly like handleMessageSubmitLocalLlm", async () => {
    const store = await createLocalStore();
    jest.spyOn(console, "log").mockImplementation(() => undefined);

    await store.runLocalEvalTurns(twoCases as any);

    // buildSchemaDigest runs unconditionally (same as handleMessageSubmitLocalLlm); buildGraphSeed
    // is conditional on a selected graph ID, which this standalone (parentless) store has none of
    // — mirroring handleMessageSubmitLocalLlm's own tests, which don't assert on it either.
    expect(buildSchemaDigest).toHaveBeenCalled();
    // dispatchTool is reachable via the same executeTool wiring if a case's mocked turn calls it.
    (runLocalTurn as jest.Mock).mockImplementationOnce(async (args: any) => {
      await args.executeTool("get_graph_info", {});
      return "done";
    });
    await store.runLocalEvalTurns([twoCases[0]] as any);
    expect(dispatchTool).toHaveBeenCalledWith("get_graph_info", {}, expect.anything());

    // eslint-disable-next-line no-console
    (console.log as jest.Mock).mockRestore();
  });

  it("does not post a summary when the eval run is cancelled mid-run (epoch reuse)", async () => {
    const store = await createLocalStore();
    const consoleLogSpy = jest.spyOn(console, "log").mockImplementation(() => undefined);
    let release: (v: string) => void = () => undefined;
    (runLocalTurn as jest.Mock).mockImplementationOnce(
      () => new Promise((res) => { release = res; })
    );

    const evalRun = store.runLocalEvalTurns(twoCases as any);
    await Promise.resolve();

    await store.handleCancel(); // bumps the shared turnEpoch, same as an in-flight chat turn

    release("late reply after cancel");
    await evalRun;
    await Promise.resolve();

    const contents = store.transcriptStore.messages.map((m) => m.messageContent.content);
    expect(contents.some((c) => typeof c === "string" && /passed/.test(c))).toBe(false);
    expect(consoleLogSpy).not.toHaveBeenCalledWith("DAVAI local eval results", expect.anything());

    consoleLogSpy.mockRestore();
  });

  it("clears the busy flags when the model is switched mid-eval-run, posting no summary", async () => {
    // Same reasoning as the chat-turn case: a model switch during an eval run is not superseded
    // by any newer turn, so nothing else will ever clear isLoadingResponse/showLoadingIndicator
    // unless setLlmId does it itself.
    const store = await createLocalStore();
    const consoleLogSpy = jest.spyOn(console, "log").mockImplementation(() => undefined);
    let release: (v: string) => void = () => undefined;
    (runLocalTurn as jest.Mock).mockImplementationOnce(
      () => new Promise((res) => { release = res; })
    );

    const evalRun = store.runLocalEvalTurns(twoCases as any);
    // Two ticks: runLocalEvalTurns is now one MST node deeper (a child of the eval's
    // TestRootStore, for the fixture-guard's getRoot(self).sonificationStore read) than a
    // bare AssistantModel, which costs one extra microtask hop before the flow's first `yield`
    // (loadEngine) resumes into the mocked runLocalTurn call below — a single tick would resolve
    // before that mock's promise executor assigns `release`.
    await Promise.resolve();
    await Promise.resolve();
    expect(store.isLoadingResponse).toBe(true);

    store.setLlmId(JSON.stringify({ id: "Qwen3-4B-q4f16_1-MLC", provider: "Local" }));

    expect(store.isLoadingResponse).toBe(false);
    expect(store.showLoadingIndicator).toBe(false);

    release("late reply after switch");
    await evalRun;
    await Promise.resolve();

    expect(store.isLoadingResponse).toBe(false);
    const contents = store.transcriptStore.messages.map((m) => m.messageContent.content);
    expect(contents.some((c) => typeof c === "string" && /passed/.test(c))).toBe(false);
    expect(consoleLogSpy).not.toHaveBeenCalledWith("DAVAI local eval results", expect.anything());

    consoleLogSpy.mockRestore();
  });

  it("announces already-in-progress and does not start a second run when an eval is already running", async () => {
    const store = await createLocalStore();
    const consoleLogSpy = jest.spyOn(console, "log").mockImplementation(() => undefined);
    let release: () => void = () => undefined;
    (localLlmService.loadEngine as jest.Mock).mockImplementationOnce(
      () => new Promise<void>((res) => { release = res; })
    );

    const first = store.runLocalEvalTurns(twoCases as any);
    await Promise.resolve();
    expect(store.isLoadingResponse).toBe(true);
    expect(localLlmService.loadEngine).toHaveBeenCalledTimes(1);

    // A second eval call while one is in flight must be rejected outright (not queued as a
    // message, and not started as a concurrent run) — it must not call loadEngine again.
    await store.runLocalEvalTurns(twoCases as any);
    expect(localLlmService.loadEngine).toHaveBeenCalledTimes(1);

    const contents = store.transcriptStore.messages.map((m) => m.messageContent.content);
    expect(contents.some((c) => typeof c === "string" && /already in progress/i.test(c))).toBe(true);

    // A live chat message submitted during the eval must queue rather than run concurrently.
    const queued = store.handleMessageSubmitLocalLlm("hi");
    await Promise.resolve();
    expect(store.messageQueue.slice()).toContain("hi");
    expect(runLocalTurn).not.toHaveBeenCalled();

    release();
    await first;
    await queued;
    await Promise.resolve();

    // Once the eval completes, the queued chat message drains and actually runs.
    expect(runLocalTurn).toHaveBeenCalledWith(expect.objectContaining({ userMessage: "hi" }));
    expect(store.messageQueue.length).toBe(0);

    consoleLogSpy.mockRestore();
  });

  it("sets isLoadingResponse/showLoadingIndicator during the run and clears them on completion and on rejection", async () => {
    const store = await createLocalStore();
    const consoleLogSpy = jest.spyOn(console, "log").mockImplementation(() => undefined);

    // Completion path.
    let release: () => void = () => undefined;
    (localLlmService.loadEngine as jest.Mock).mockImplementationOnce(
      () => new Promise<void>((res) => { release = res; })
    );
    const run = store.runLocalEvalTurns(twoCases as any);
    await Promise.resolve();
    expect(store.isLoadingResponse).toBe(true);
    expect(store.showLoadingIndicator).toBe(true);
    release();
    await run;
    expect(store.isLoadingResponse).toBe(false);
    expect(store.showLoadingIndicator).toBe(false);

    // Rejection path.
    (localLlmService.loadEngine as jest.Mock).mockRejectedValueOnce(new Error("boom"));
    await store.runLocalEvalTurns(twoCases as any);
    expect(store.isLoadingResponse).toBe(false);
    expect(store.showLoadingIndicator).toBe(false);

    consoleLogSpy.mockRestore();
  });

  it("resolves (no unhandled rejection), announces the error, and posts no summary or console dump when loadEngine rejects", async () => {
    const store = await createLocalStore();
    const consoleLogSpy = jest.spyOn(console, "log").mockImplementation(() => undefined);
    const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    (localLlmService.loadEngine as jest.Mock).mockRejectedValueOnce(new Error("engine failed to load"));

    await expect(store.runLocalEvalTurns(twoCases as any)).resolves.toBeUndefined();

    const contents = store.transcriptStore.messages.map((m) => m.messageContent.content);
    expect(contents.some((c) => typeof c === "string" && /local eval failed/i.test(c) && /engine failed to load/.test(c)))
      .toBe(true);
    expect(contents.some((c) => typeof c === "string" && /passed/.test(c))).toBe(false);
    expect(consoleLogSpy).not.toHaveBeenCalledWith("DAVAI local eval results", expect.anything());
    expect(consoleErrorSpy).toHaveBeenCalledWith("Local eval failed:", expect.any(Error));
    expect(store.isLoadingResponse).toBe(false);
    expect(store.showLoadingIndicator).toBe(false);

    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  it("resolves, announces the error, and posts no summary or console dump when a step after loadEngine throws", async () => {
    // Exercises the catch block via a distinct failure point from loadEngine (buildSchemaDigest,
    // called unconditionally in the body) so the guard isn't just special-cased around the engine
    // load — any synchronous failure in the eval setup must resolve cleanly, not reject/hang.
    const store = await createLocalStore();
    const consoleLogSpy = jest.spyOn(console, "log").mockImplementation(() => undefined);
    const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    (buildSchemaDigest as jest.Mock).mockImplementationOnce(() => { throw new Error("digest boom"); });

    await expect(store.runLocalEvalTurns(twoCases as any)).resolves.toBeUndefined();

    const contents = store.transcriptStore.messages.map((m) => m.messageContent.content);
    expect(contents.some((c) => typeof c === "string" && /local eval failed/i.test(c) && /digest boom/.test(c)))
      .toBe(true);
    expect(contents.some((c) => typeof c === "string" && /passed/.test(c))).toBe(false);
    expect(consoleLogSpy).not.toHaveBeenCalledWith("DAVAI local eval results", expect.anything());
    expect(consoleErrorSpy).toHaveBeenCalledWith("Local eval failed:", expect.any(Error));
    expect(store.isLoadingResponse).toBe(false);
    expect(store.showLoadingIndicator).toBe(false);

    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  describe("fixture guard: a graph must be selected before the eval runs", () => {
    it("announces instead of running the battery when no graph is selected and there are zero " +
      "graphs, and sticks no flags", async () => {
      const store = await createLocalStore(null); // no selectedGraphID, no graphs
      const consoleLogSpy = jest.spyOn(console, "log").mockImplementation(() => undefined);

      await store.runLocalEvalTurns(twoCases as any);

      const contents = store.transcriptStore.messages.map((m) => m.messageContent.content);
      expect(contents).toContain(
        "Select a graph before running the eval — pick it in the Sonification section's graph menu " +
        "(fixture: Mammals sample with a Height dot plot selected)."
      );
      // No battery ran at all: no case turns, no engine load, no completion summary/console dump.
      expect(runLocalTurn).not.toHaveBeenCalled();
      expect(localLlmService.loadEngine).not.toHaveBeenCalled();
      expect(contents.some((c) => typeof c === "string" && /passed/.test(c))).toBe(false);
      expect(consoleLogSpy).not.toHaveBeenCalledWith("DAVAI local eval results", expect.anything());
      // No flags left stuck.
      expect(store.isLoadingResponse).toBe(false);
      expect(store.showLoadingIndicator).toBe(false);

      consoleLogSpy.mockRestore();
    });

    it("still announces (mentioning the Sonification section) when two graphs exist and neither " +
      "is selected — ambiguous, so the single-graph fallback cannot apply", async () => {
      const store = await createLocalStore(null, [{ id: 10 }, { id: 20 }]);
      const consoleLogSpy = jest.spyOn(console, "log").mockImplementation(() => undefined);

      await store.runLocalEvalTurns(twoCases as any);

      const contents = store.transcriptStore.messages.map((m) => m.messageContent.content);
      expect(contents.some((c) => typeof c === "string" && /Sonification section/.test(c))).toBe(true);
      expect(runLocalTurn).not.toHaveBeenCalled();
      expect(localLlmService.loadEngine).not.toHaveBeenCalled();

      consoleLogSpy.mockRestore();
    });

    it("runs the battery normally when a graph IS selected (the default fixture state)", async () => {
      const store = await createLocalStore(1);
      const consoleLogSpy = jest.spyOn(console, "log").mockImplementation(() => undefined);

      await store.runLocalEvalTurns(twoCases as any);

      expect(localLlmService.loadEngine).toHaveBeenCalled();
      expect(runLocalTurn).toHaveBeenCalledTimes(2);
      const contents = store.transcriptStore.messages.map((m) => m.messageContent.content);
      expect(contents.some((c) => typeof c === "string" && /passed/.test(c))).toBe(true);
      expect(contents.some((c) => typeof c === "string" && /Select a graph before running the eval/.test(c)))
        .toBe(false);

      consoleLogSpy.mockRestore();
    });

    it("runs the battery normally with one graph and NO sonification selection (single-graph " +
      "documents need no manual pick)", async () => {
      const store = await createLocalStore(null, [{ id: 99 }]); // no selectedGraphID, exactly one graph
      const consoleLogSpy = jest.spyOn(console, "log").mockImplementation(() => undefined);

      await store.runLocalEvalTurns(twoCases as any);

      expect(localLlmService.loadEngine).toHaveBeenCalled();
      expect(runLocalTurn).toHaveBeenCalledTimes(2);
      const contents = store.transcriptStore.messages.map((m) => m.messageContent.content);
      expect(contents.some((c) => typeof c === "string" && /passed/.test(c))).toBe(true);
      expect(contents.some((c) => typeof c === "string" && /Select a graph before running the eval/.test(c)))
        .toBe(false);

      consoleLogSpy.mockRestore();
    });

    it("does not queue a subsequent chat message submitted right after the guard's early return " +
      "(the guard never sets isLoadingResponse, so nothing needs draining)", async () => {
      const store = await createLocalStore(null);
      jest.spyOn(console, "log").mockImplementation(() => undefined);

      await store.runLocalEvalTurns(twoCases as any);
      expect(store.isLoadingResponse).toBe(false);

      const submitted = store.handleMessageSubmitLocalLlm("hi");
      await Promise.resolve();
      // Not queued — it should run directly, since the guard's early return left nothing in flight.
      expect(store.messageQueue.slice()).not.toContain("hi");
      await submitted;

      // eslint-disable-next-line no-console
      (console.log as jest.Mock).mockRestore();
    });
  });

  describe("thinking toggle", () => {
    it("effort 'think' builds the eval prompt with thinking:true and calls generate with " +
      "maxTokens 2048", async () => {
        const store = await createLocalStore();
        store.setEffort("think");
        jest.spyOn(console, "log").mockImplementation(() => undefined);

        await store.runLocalEvalTurns(twoCases as any);

        const args = (runLocalTurn as jest.Mock).mock.calls.at(-1)![0];
        expect(args.systemPrompt.trimEnd().endsWith("/think")).toBe(true);

        (localLlmService.generate as jest.Mock).mockClear();
        await args.generate([{ role: "user", content: "hi" }]);
        expect(localLlmService.generate).toHaveBeenCalledWith(
          [{ role: "user", content: "hi" }], { maxTokens: 2048 }
        );

        // eslint-disable-next-line no-console
        (console.log as jest.Mock).mockRestore();
      });

    it("effort '' builds the eval prompt with thinking:false and calls generate with " +
      "maxTokens 1024", async () => {
        const store = await createLocalStore();
        store.setEffort("");
        jest.spyOn(console, "log").mockImplementation(() => undefined);

        await store.runLocalEvalTurns(twoCases as any);

        const args = (runLocalTurn as jest.Mock).mock.calls.at(-1)![0];
        expect(args.systemPrompt.trimEnd().endsWith("/no_think")).toBe(true);

        (localLlmService.generate as jest.Mock).mockClear();
        await args.generate([{ role: "user", content: "hi" }]);
        expect(localLlmService.generate).toHaveBeenCalledWith(
          [{ role: "user", content: "hi" }], { maxTokens: 1024 }
        );

        // eslint-disable-next-line no-console
        (console.log as jest.Mock).mockRestore();
      });
  });
});

describe("sonification auto-select on local create_graph", () => {
  // On the server path, the registered sendCODAPRequest flow (processToolCall,
  // assistant-model.ts ~line 268) runs `root.sonificationStore.setGraphs({ selectNewest: true })`
  // right after a successful `create component (graph)` request. The local path's create_graph
  // tool (src/utils/local-llm/tools/create-graph.ts) never calls sendCODAPRequest through that
  // guard — it calls `ctx.refreshGraphs()` instead, so refreshGraphs itself must also trigger the
  // sonification side effect. Needs a real parent (getRoot(self)) for that write to land anywhere
  // observable — mirrors the runLocalEvalTurns TestRootStore above.
  const TestRootStore = types.model("TestRootStore", {
    assistantStore: AssistantModel,
    sonificationStore: GraphSonificationModel,
  });

  const createRootedStore = () => {
    const transcriptStore = ChatTranscriptModel.create({ messages: [] });
    const root = TestRootStore.create({
      assistantStore: { transcriptStore, threadId: "thread-1" },
      sonificationStore: { allGraphs: {}, binValues: {} },
    });
    const store = root.assistantStore;
    store.setLlmId(JSON.stringify({ id: "Qwen3-1.7B-q4f16_1-MLC", provider: "Local" }));
    return { root, store };
  };

  // A single sonifiable graph (univariate dot plot: one axis, no splits) freshly "created" —
  // i.e. not already present in allGraphs, so setGraphs' selectNewest logic picks it up.
  const newSonifiableGraph = {
    id: 42, name: "Height", title: "Height", plotType: "dotPlot", dataContext: "Mammals",
    xAttributeID: 1, xAttributeName: "Height",
  };

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("refreshes both graph stores after a server-path graph create with a dataContext-scoped " +
    "resource (CODAP 3.1 no longer echoes component notifications to the initiating plugin)", async () => {
    const { root, store } = createRootedStore();
    store.setLlmId(JSON.stringify({ id: "gpt-5.4-mini", provider: "OpenAI" }));
    expect(root.sonificationStore.selectedGraphID).toBeUndefined();
    (codapInterface.sendRequest as jest.Mock).mockResolvedValueOnce({ success: true, values: { id: 42 } });
    (getGraphDetails as jest.Mock).mockResolvedValueOnce([newSonifiableGraph]);

    // The LLM routinely emits the scoped resource form, which CODAP accepts; the refresh
    // guard must not require the bare "component" spelling.
    await store.processToolCall({
      tool_call_id: "call-1",
      type: "create_request",
      request: {
        action: "create",
        resource: "dataContext[233176388495090].component",
        values: { type: "graph", dataContext: "TestData", xAttributeID: 1, yAttributeID: 2 },
      },
    } as any);

    expect(root.sonificationStore.selectedGraphID).toBe(42);
    // The assistant's own graph context must refresh too — it also relied on the echo.
    expect(getTrimmedGraphDetails).toHaveBeenCalled();
  });

  it("selects the newly created graph in the sonification store after a local create_graph " +
    "tool call (chat wiring, handleMessageSubmitLocalLlm)", async () => {
    const { root, store } = createRootedStore();
    expect(root.sonificationStore.selectedGraphID).toBeUndefined();
    (getGraphDetails as jest.Mock).mockResolvedValueOnce([newSonifiableGraph]);

    (runLocalTurn as jest.Mock).mockImplementationOnce(async (args: any) => {
      // Reproduces create-graph.ts's real post-success step (its own execute() is not exercised
      // here — dispatchTool is mocked module-wide — but its ctx.refreshGraphs() call is the exact
      // seam under test): capture the real toolCtx built by assistant-model.ts and invoke the
      // same refreshGraphs it would.
      await args.executeTool("create_graph", { dataContext: "Mammals", xAttribute: "Height" });
      const toolCtx = (dispatchTool as jest.Mock).mock.calls.at(-1)![2];
      await toolCtx.refreshGraphs();
      return "Created graph \"Height\".";
    });

    await store.handleMessageSubmitLocalLlm("create a graph of height");

    expect(root.sonificationStore.selectedGraphID).toBe(42);
  });

  it("selects the newly created graph in the sonification store after a local create_graph " +
    "tool call (eval wiring, runLocalEvalTurns)", async () => {
    const { root, store } = createRootedStore();
    // The eval fixture guard requires a resolvable current graph before it will run at all —
    // seed one pre-existing graph via the real updateGraphs action rather than poking
    // store.graphs directly (MST strict mode).
    (getTrimmedGraphDetails as jest.Mock).mockResolvedValueOnce([{ id: 1, name: "Existing" }]);
    await store.updateGraphs();
    root.sonificationStore.setSelectedGraphID(1);
    (getGraphDetails as jest.Mock).mockResolvedValueOnce([newSonifiableGraph]);
    const consoleLogSpy = jest.spyOn(console, "log").mockImplementation(() => undefined);

    (runLocalTurn as jest.Mock).mockImplementationOnce(async (args: any) => {
      await args.executeTool("create_graph", { dataContext: "Mammals", xAttribute: "Height" });
      const toolCtx = (dispatchTool as jest.Mock).mock.calls.at(-1)![2];
      await toolCtx.refreshGraphs();
      return "Created graph \"Height\".";
    });

    await store.runLocalEvalTurns([
      { id: "case-a", prompt: "create a graph of height", expectTools: { contains: ["create_graph"] },
        expectFinal: { matches: [/Height/] } },
    ] as any);

    expect(root.sonificationStore.selectedGraphID).toBe(42);

    consoleLogSpy.mockRestore();
  });
});

describe("refreshGraphList: refills graphs WITHOUT the selectNewest side effect", () => {
  // update_graph (src/utils/local-llm/tools/update-graph.ts) mutates an EXISTING graph, so it
  // must refresh the graph list through ctx.refreshGraphList(), never ctx.refreshGraphs() — the
  // latter's setGraphs({ selectNewest: true }) call would risk stealing the current sonification
  // selection. This proves the real toolCtx wired by assistant-model.ts keeps that promise: the
  // graph list is refilled, but selectedGraphID is untouched.
  const TestRootStore = types.model("TestRootStore", {
    assistantStore: AssistantModel,
    sonificationStore: GraphSonificationModel,
  });

  const createRootedStore = () => {
    const transcriptStore = ChatTranscriptModel.create({ messages: [] });
    const root = TestRootStore.create({
      assistantStore: { transcriptStore, threadId: "thread-1" },
      sonificationStore: { allGraphs: {}, binValues: {} },
    });
    const store = root.assistantStore;
    store.setLlmId(JSON.stringify({ id: "Qwen3-1.7B-q4f16_1-MLC", provider: "Local" }));
    return { root, store };
  };

  const updatedGraph = {
    id: 42, name: "Height vs Mass", title: "Height vs Mass", plotType: "scatterPlot", dataContext: "Mammals",
    xAttributeName: "Height", yAttributeName: "Sleep",
  };

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("chat wiring (handleMessageSubmitLocalLlm): refills store.graphs but leaves " +
    "selectedGraphID unset", async () => {
    const { root, store } = createRootedStore();
    expect(root.sonificationStore.selectedGraphID).toBeUndefined();
    (getTrimmedGraphDetails as jest.Mock).mockResolvedValueOnce([updatedGraph]);

    (runLocalTurn as jest.Mock).mockImplementationOnce(async (args: any) => {
      await args.executeTool("update_graph", { graph: "Height vs Mass", yAttribute: "Sleep" });
      const toolCtx = (dispatchTool as jest.Mock).mock.calls.at(-1)![2];
      await toolCtx.refreshGraphList();
      return "Updated graph \"Height vs Mass\": y-axis is now Sleep.";
    });

    await store.handleMessageSubmitLocalLlm("change the y-axis to sleep");

    expect(store.graphs).toEqual([updatedGraph]);
    expect(root.sonificationStore.selectedGraphID).toBeUndefined();
  });

  it("chat wiring: does not disturb an EXISTING selection either", async () => {
    const { root, store } = createRootedStore();
    // Seed a real, sonifiable graph into the sonification store's OWN allGraphs (via setGraphs,
    // no selectNewest) and select it directly — the sonification store's own reaction clears
    // selectedGraphID whenever it doesn't reference a graph actually present in allGraphs (see
    // graph-sonification-model.ts's afterCreate), so an arbitrary id would be auto-cleared
    // regardless of anything under test here.
    (getGraphDetails as jest.Mock).mockResolvedValueOnce([updatedGraph]);
    await root.sonificationStore.setGraphs();
    root.sonificationStore.setSelectedGraphID(42);
    expect(root.sonificationStore.selectedGraphID).toBe(42);
    (getTrimmedGraphDetails as jest.Mock).mockResolvedValueOnce([updatedGraph]);

    (runLocalTurn as jest.Mock).mockImplementationOnce(async (args: any) => {
      await args.executeTool("update_graph", { graph: "Height vs Mass", yAttribute: "Sleep" });
      const toolCtx = (dispatchTool as jest.Mock).mock.calls.at(-1)![2];
      await toolCtx.refreshGraphList();
      return "Updated graph \"Height vs Mass\": y-axis is now Sleep.";
    });

    await store.handleMessageSubmitLocalLlm("change the y-axis to sleep");

    expect(store.graphs).toEqual([updatedGraph]);
    expect(root.sonificationStore.selectedGraphID).toBe(42);
  });

  it("eval wiring (runLocalEvalTurns): refills store.graphs but leaves selectedGraphID " +
    "untouched from whatever the fixture guard set it to", async () => {
    const { root, store } = createRootedStore();
    // Same real-graph seeding as the chat-wiring test above (see its comment) — the eval fixture
    // guard also needs a resolvable current graph before it will run at all.
    (getGraphDetails as jest.Mock).mockResolvedValueOnce([updatedGraph]);
    await root.sonificationStore.setGraphs();
    root.sonificationStore.setSelectedGraphID(42);
    (getTrimmedGraphDetails as jest.Mock).mockResolvedValueOnce([updatedGraph]);
    const consoleLogSpy = jest.spyOn(console, "log").mockImplementation(() => undefined);

    (runLocalTurn as jest.Mock).mockImplementationOnce(async (args: any) => {
      await args.executeTool("update_graph", { graph: "Height vs Mass", yAttribute: "Sleep" });
      const toolCtx = (dispatchTool as jest.Mock).mock.calls.at(-1)![2];
      await toolCtx.refreshGraphList();
      return "Updated graph \"Height vs Mass\": y-axis is now Sleep.";
    });

    await store.runLocalEvalTurns([
      { id: "case-a", prompt: "change the y-axis to sleep", expectTools: { contains: ["update_graph"] },
        expectFinal: { matches: [/Sleep/] } },
    ] as any);

    expect(store.graphs).toEqual([updatedGraph]);
    expect(root.sonificationStore.selectedGraphID).toBe(42);

    consoleLogSpy.mockRestore();
  });
});

describe("handleCancel over WebSocket", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it("sends the cancel over the socket instead of POSTing to the legacy cancel endpoint", async () => {
    const store = createStore();
    store.setUseWebSocket(true);
    // If the legacy HTTP path were (wrongly) taken, let it complete instead of hanging the test.
    mockedPostMessage.mockResolvedValue({ ok: true, json: async () => ({}) } as Response);

    // Park a turn in flight over the WS transport (the mocked runTurn never resolves);
    // submitting sets currentMessageId, the gate on handleCancel's server branch.
    store.handleMessageSubmit("hello");
    await Promise.resolve();
    expect(store.isLoadingResponse).toBe(true);

    await store.handleCancel();

    const transport = (WsTransport as unknown as jest.Mock).mock.results[0].value;
    expect(transport.cancel).toHaveBeenCalledTimes(1);
    expect(mockedPostMessage).not.toHaveBeenCalled();
    expect(store.isCancelling).toBe(false);
  });
});

describe("session usage accumulation", () => {
  it("accumulates usage per model and prices the session (caching-aware)", () => {
    const store = createStore();
    store.setLlmId(JSON.stringify({ id: "claude-haiku-4-5", provider: "Anthropic" }));
    store.recordUsage({ input_tokens: 10732, output_tokens: 5,
      input_token_details: { cache_read: 0, cache_creation: 10586 } });
    store.recordUsage({ input_tokens: 10744, output_tokens: 8,
      input_token_details: { cache_read: 10586, cache_creation: 0 } });

    const summary = store.sessionCostSummary;
    expect(summary.models).toHaveLength(1);
    expect(summary.models[0].model).toBe("claude-haiku-4-5");
    expect(summary.models[0].input).toBe(21476);
    expect(summary.models[0].output).toBe(13);
    expect(summary.models[0].cacheRead).toBe(10586);
    expect(summary.models[0].cacheWrite).toBe(10586);
    expect(summary.totals.totalCost).toBeGreaterThan(0);
    // Caching-aware: far below the naive 21476 tokens x $1/M
    expect(summary.totals.totalCost!).toBeLessThan(0.0215);
  });

  it("keys usage by model when the model changes mid-session", () => {
    const store = createStore();
    store.setLlmId(JSON.stringify({ id: "claude-haiku-4-5", provider: "Anthropic" }));
    store.recordUsage({ input_tokens: 100, output_tokens: 10 });
    store.setLlmId(JSON.stringify({ id: "gpt-5.6-luna", provider: "OpenAI" }));
    store.recordUsage({ input_tokens: 200, output_tokens: 20 });
    expect(store.sessionCostSummary.models.map((m: any) => m.model).sort())
      .toEqual(["claude-haiku-4-5", "gpt-5.6-luna"]);
  });

  it("attributes usage to the request's llmId, not the currently selected model", () => {
    // Regression: a model switch while a turn is in flight must not book the old
    // model's tokens under the new one — call sites pass the llmId the request
    // was sent with, and recordUsage must prefer it over self.llmId.
    const store = createStore();
    store.setLlmId(JSON.stringify({ id: "gpt-5.6-luna", provider: "OpenAI" }));
    store.recordUsage({ input_tokens: 100, output_tokens: 10 },
      JSON.stringify({ id: "claude-haiku-4-5", provider: "Anthropic" }));
    expect(store.sessionCostSummary.models.map((m: any) => m.model))
      .toEqual(["claude-haiku-4-5"]);
  });

  it("reports an n/a session total when any model is unpriced, instead of a partial sum", () => {
    const store = createStore();
    store.setLlmId(JSON.stringify({ id: "claude-haiku-4-5", provider: "Anthropic" }));
    store.recordUsage({ input_tokens: 100, output_tokens: 10 });
    expect(store.sessionCostSummary.totals.totalCost).toBeGreaterThan(0);
    // Malformed llmId → usage lands under the unpriced "unknown" key.
    store.recordUsage({ input_tokens: 500, output_tokens: 50 }, "not-json");
    expect(store.sessionCostSummary.models).toHaveLength(2);
    expect(store.sessionCostSummary.totals.totalCost).toBeUndefined();
  });

  it("ignores undefined usage and adds a debug entry when recording", () => {
    const store = createStore();
    store.setLlmId(JSON.stringify({ id: "claude-haiku-4-5", provider: "Anthropic" }));
    store.recordUsage(undefined);
    expect(store.sessionCostSummary.models).toHaveLength(0);
    store.recordUsage({ input_tokens: 50, output_tokens: 5 });
    const dbg = store.transcriptStore.messages.filter(
      (m: any) => m.messageContent.description === "Token usage");
    expect(dbg).toHaveLength(1);
  });
});
