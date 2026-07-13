const mockCreate = jest.fn();
const mockEngine = {
  chat: { completions: { create: mockCreate } },
  interruptGenerate: jest.fn(),
  unload: jest.fn().mockResolvedValue(undefined),
};
const mockCreateWebWorkerMLCEngine = jest.fn().mockResolvedValue(mockEngine);

jest.mock("@mlc-ai/web-llm", () => ({
  CreateWebWorkerMLCEngine: (...args: any[]) => mockCreateWebWorkerMLCEngine(...args),
}));
// A distinct worker object per call (each with its own `terminate` spy) so a test can assert
// specifically which load's worker was torn down.
const mockCreateLocalLlmWorker = jest.fn(() => ({ terminate: jest.fn() } as unknown as Worker));
jest.mock("./local-llm-worker-factory", () => ({
  createLocalLlmWorker: () => mockCreateLocalLlmWorker(),
}));

import { localLlmService } from "./local-llm-service";

beforeEach(() => {
  jest.clearAllMocks();
  (globalThis.navigator as any).gpu = {};
});

afterEach(async () => {
  await localLlmService.unload();
  delete (globalThis.navigator as any).gpu;
});

it("reports WebGPU availability from navigator.gpu", () => {
  expect(localLlmService.isWebGPUAvailable()).toBe(true);
  delete (globalThis.navigator as any).gpu;
  expect(localLlmService.isWebGPUAvailable()).toBe(false);
});

it("loads the engine with the 8K context override and reaches ready", async () => {
  await localLlmService.loadEngine("Qwen3-1.7B-q4f16_1-MLC");
  expect(mockCreateWebWorkerMLCEngine).toHaveBeenCalledTimes(1);
  const [, modelId, engineConfig, chatOpts] = mockCreateWebWorkerMLCEngine.mock.calls[0];
  expect(modelId).toBe("Qwen3-1.7B-q4f16_1-MLC");
  expect(engineConfig.initProgressCallback).toEqual(expect.any(Function));
  expect(chatOpts).toEqual({ context_window_size: 8192 });
  expect(localLlmService.getLoadState().status).toBe("ready");
});

it("is idempotent for the same model and reloads for a different one", async () => {
  await localLlmService.loadEngine("Qwen3-1.7B-q4f16_1-MLC");
  await localLlmService.loadEngine("Qwen3-1.7B-q4f16_1-MLC");
  expect(mockCreateWebWorkerMLCEngine).toHaveBeenCalledTimes(1);
  await localLlmService.loadEngine("Qwen3-4B-q4f16_1-MLC");
  expect(mockEngine.unload).toHaveBeenCalled();
  expect(mockCreateWebWorkerMLCEngine).toHaveBeenCalledTimes(2);
});

it("emits load-state changes to subscribers and supports unsubscribe", async () => {
  const seen: string[] = [];
  const off = localLlmService.onLoadStateChange((s) => seen.push(s.status));
  await localLlmService.loadEngine("Qwen3-1.7B-q4f16_1-MLC");
  expect(seen).toContain("loading");
  expect(seen[seen.length - 1]).toBe("ready");
  off();
  await localLlmService.unload();
  expect(seen[seen.length - 1]).toBe("ready"); // no events after unsubscribe
});

it("generates unconstrained (no response_format) with temperature 0 / max_tokens 1024 by default", async () => {
  mockCreate.mockResolvedValue({ choices: [{ message: { content: "{\"tool\":\"final\",\"response\":\"hi\"}" } }] });
  await localLlmService.loadEngine("Qwen3-1.7B-q4f16_1-MLC");
  const out = await localLlmService.generate([{ role: "user", content: "hello" }]);
  expect(out).toBe("{\"tool\":\"final\",\"response\":\"hi\"}");
  const call = mockCreate.mock.calls[0][0];
  expect(call).toEqual(expect.objectContaining({
    temperature: 0,
    max_tokens: 1024,
  }));
  // 0.2.84's schema-less json_object mode is broken (compileJSONSchema(undefined) throws a
  // wasm BindingError as an uncaught worker-side rejection) — response_format must never be sent.
  expect(call).not.toHaveProperty("response_format");
});

it("threads an explicit maxTokens through to the engine call", async () => {
  mockCreate.mockResolvedValue({ choices: [{ message: { content: "hi" } }] });
  await localLlmService.loadEngine("Qwen3-1.7B-q4f16_1-MLC");
  await localLlmService.generate([{ role: "user", content: "hello" }], { maxTokens: 2048 });
  const call = mockCreate.mock.calls[0][0];
  expect(call).toEqual(expect.objectContaining({ max_tokens: 2048 }));
});

describe("generate watchdog", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("rejects with a clear timeout error and interrupts the engine when the engine call never settles", async () => {
    // Simulates the 0.2.84 worker-side BindingError being thrown as an uncaught rejection that
    // never reaches this promise — create() just hangs forever from generate()'s point of view.
    mockCreate.mockImplementation(() => new Promise(() => undefined));
    await localLlmService.loadEngine("Qwen3-1.7B-q4f16_1-MLC");

    const pending = localLlmService.generate([{ role: "user", content: "hello" }]);
    // advanceTimersByTimeAsync flushes the fake-timer callback (which rejects the race) and lets
    // its microtasks settle before resolving, so `pending` is already rejected by the time this
    // resolves — no separate "swallow the eventual rejection" step needed.
    const advance = jest.advanceTimersByTimeAsync(300_000);
    await Promise.all([expect(pending).rejects.toThrow(/timed out/i), advance]);

    expect(mockEngine.interruptGenerate).toHaveBeenCalledTimes(1);
  });

  it("does not time out and clears its timer when the engine call resolves normally", async () => {
    mockCreate.mockResolvedValue({ choices: [{ message: { content: "hi" } }] });
    await localLlmService.loadEngine("Qwen3-1.7B-q4f16_1-MLC");

    const out = await localLlmService.generate([{ role: "user", content: "hello" }]);
    expect(out).toBe("hi");

    // If the watchdog timer weren't cleared, advancing past it would either throw (no dangling
    // timer should still be able to reject an already-settled promise) or leave a stray timer
    // warning; asserting no further interrupt call is the direct behavioral check.
    await jest.advanceTimersByTimeAsync(300_000);
    expect(mockEngine.interruptGenerate).not.toHaveBeenCalled();
  });
});

it("throws a clear error when generate is called before load", async () => {
  await expect(localLlmService.generate([{ role: "user", content: "x" }]))
    .rejects.toThrow(/not loaded/i);
});

it("sets error state when engine creation fails", async () => {
  mockCreateWebWorkerMLCEngine.mockRejectedValueOnce(new Error("boom"));
  await expect(localLlmService.loadEngine("Qwen3-1.7B-q4f16_1-MLC")).rejects.toThrow("boom");
  expect(localLlmService.getLoadState()).toEqual(
    expect.objectContaining({ status: "error", error: "boom" })
  );
});

it("terminates the worker of a still-current load that fails so it does not leak", async () => {
  mockCreateWebWorkerMLCEngine.mockRejectedValueOnce(new Error("boom"));
  await expect(localLlmService.loadEngine("Qwen3-1.7B-q4f16_1-MLC")).rejects.toThrow("boom");
  // The worker created for this failed-but-still-current load must be terminated, not left
  // registered in inflightLoad (which would leak a live Worker + GPU/WASM until a later load
  // superseded it, or forever if the user gives up).
  const worker = mockCreateLocalLlmWorker.mock.results.at(-1)!.value as { terminate: jest.Mock };
  expect(worker.terminate).toHaveBeenCalledTimes(1);
});

// A distinct engine per CreateWebWorkerMLCEngine call, each with its own unload spy, so a
// stale-load's engine can be told apart from the winner's.
const makeEngine = () => ({
  chat: { completions: { create: jest.fn() } },
  interruptGenerate: jest.fn(),
  unload: jest.fn().mockResolvedValue(undefined),
});

// Wait until the engine factory has been called `n` times, i.e. doLoad has cleared the dynamic
// import() and is actually awaiting engine creation. Flushing a fixed number of microtasks is
// brittle (the mocked import() resolves over several ticks); poll instead.
const waitForCreateCalls = async (n: number) => {
  for (let i = 0; i < 100 && mockCreateWebWorkerMLCEngine.mock.calls.length < n; i++) {
    await Promise.resolve();
  }
};

it("keeps only the second model's engine when models are switched mid-load", async () => {
  const engineA = makeEngine();
  const engineB = makeEngine();
  let resolveA: (e: any) => void = () => undefined;
  let resolveB: (e: any) => void = () => undefined;
  mockCreateWebWorkerMLCEngine
    .mockImplementationOnce(() => new Promise((res) => { resolveA = res; }))
    .mockImplementationOnce(() => new Promise((res) => { resolveB = res; }));

  const states: string[] = [];
  const off = localLlmService.onLoadStateChange((s) => states.push(`${s.status}:${s.modelId ?? ""}`));

  const loadA = localLlmService.loadEngine("Qwen3-1.7B-q4f16_1-MLC");
  await waitForCreateCalls(1); // A is past the dynamic import, awaiting its engine
  // While A is still downloading (engine null), select B. This must start a second load, not
  // reuse A's in-flight promise (different model id).
  const loadB = localLlmService.loadEngine("Qwen3-4B-q4f16_1-MLC");
  await waitForCreateCalls(2); // B is now awaiting its engine too

  // B finishes first and becomes the owner.
  resolveB(engineB);
  await loadB;
  // A finishes late: it is stale, so its engine must be unloaded and it must NOT overwrite the
  // ready state with the old model.
  resolveA(engineA);
  await loadA.catch(() => undefined);
  await Promise.resolve();

  expect(engineA.unload).toHaveBeenCalled();      // loser cleaned up (no GB leak)
  expect(engineB.unload).not.toHaveBeenCalled();  // winner still resident
  const finalState = localLlmService.getLoadState();
  expect(finalState.status).toBe("ready");
  expect(finalState.modelId).toBe("Qwen3-4B-q4f16_1-MLC");
  // No "ready" announcement for the stale first model.
  expect(states).toContain("ready:Qwen3-4B-q4f16_1-MLC");
  expect(states).not.toContain("ready:Qwen3-1.7B-q4f16_1-MLC");
  off();
});

it("does not announce ready when unloaded mid-load", async () => {
  const engineA = makeEngine();
  let resolveA: (e: any) => void = () => undefined;
  mockCreateWebWorkerMLCEngine.mockImplementationOnce(() => new Promise((res) => { resolveA = res; }));

  const states: string[] = [];
  const off = localLlmService.onLoadStateChange((s) => states.push(s.status));

  const loadA = localLlmService.loadEngine("Qwen3-1.7B-q4f16_1-MLC");
  await waitForCreateCalls(1); // A is past the dynamic import, awaiting its engine
  // User switches away to a server model → unload() while A is still downloading.
  await localLlmService.unload();

  resolveA(engineA);
  await loadA.catch(() => undefined);
  await Promise.resolve();

  expect(engineA.unload).toHaveBeenCalled();        // the late engine is torn down
  expect(states).not.toContain("ready");            // never announced ready
  expect(localLlmService.getLoadState().status).toBe("idle");
  off();
});

// Resolves to a rejection if `promise` doesn't settle within `ms`, instead of hanging the test
// run forever — used below for promises that must settle via terminate()'s resolve-not-reject
// path even though their underlying CreateWebWorkerMLCEngine call never itself resolves/rejects.
const withTimeoutGuard = <T,>(promise: Promise<T>, ms = 1000): Promise<T> =>
  Promise.race([
    promise,
    new Promise<T>((_res, rej) => setTimeout(() => rej(new Error("timed out waiting for promise to settle")), ms)),
  ]);

it("terminates a superseded in-flight load's worker and resolves (not rejects) its promise", async () => {
  // A's engine creation never settles — simulates a 1-2 GB download/compile still running.
  mockCreateWebWorkerMLCEngine.mockImplementationOnce(() => new Promise(() => undefined));
  const engineB = makeEngine();
  mockCreateWebWorkerMLCEngine.mockImplementationOnce(() => Promise.resolve(engineB));

  const loadA = localLlmService.loadEngine("Qwen3-1.7B-q4f16_1-MLC");
  await waitForCreateCalls(1); // A is past the dynamic import, awaiting its (never-resolving) engine
  const workerA = mockCreateLocalLlmWorker.mock.results[0].value as { terminate: jest.Mock };

  // A new claim (a different model) supersedes A while it is still in flight.
  const loadB = localLlmService.loadEngine("Qwen3-4B-q4f16_1-MLC");

  // A's worker is torn down immediately (not left running to completion), and A's own promise
  // resolves rather than rejecting — callers re-validate via isCurrent()/isStale(), so a mere
  // supersession must not read as a load failure.
  await expect(withTimeoutGuard(loadA)).resolves.toBeUndefined();
  expect(workerA.terminate).toHaveBeenCalledTimes(1);

  // B proceeds independently and reaches ready.
  await loadB;
  expect(localLlmService.getLoadState()).toEqual(
    expect.objectContaining({ status: "ready", modelId: "Qwen3-4B-q4f16_1-MLC" })
  );
});

it("terminates the in-flight load's worker and resolves its promise on unload()", async () => {
  mockCreateWebWorkerMLCEngine.mockImplementationOnce(() => new Promise(() => undefined));

  const states: string[] = [];
  const off = localLlmService.onLoadStateChange((s) => states.push(s.status));

  const loadA = localLlmService.loadEngine("Qwen3-1.7B-q4f16_1-MLC");
  await waitForCreateCalls(1);
  const workerA = mockCreateLocalLlmWorker.mock.results[0].value as { terminate: jest.Mock };

  await localLlmService.unload();

  await expect(withTimeoutGuard(loadA)).resolves.toBeUndefined();
  expect(workerA.terminate).toHaveBeenCalledTimes(1);
  expect(localLlmService.getLoadState().status).toBe("idle");
  expect(states).not.toContain("ready"); // no subscriber ever saw "ready" for the superseded load
  off();
});
