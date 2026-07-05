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
jest.mock("./local-llm-worker-factory", () => ({
  createLocalLlmWorker: jest.fn(() => ({} as Worker)),
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

it("loads the engine with the 16K context override and reaches ready", async () => {
  await localLlmService.loadEngine("Qwen3-1.7B-q4f16_1-MLC");
  expect(mockCreateWebWorkerMLCEngine).toHaveBeenCalledTimes(1);
  const [, modelId, engineConfig, chatOpts] = mockCreateWebWorkerMLCEngine.mock.calls[0];
  expect(modelId).toBe("Qwen3-1.7B-q4f16_1-MLC");
  expect(engineConfig.initProgressCallback).toEqual(expect.any(Function));
  expect(chatOpts).toEqual({ context_window_size: 16384 });
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

it("generates with temperature 0 and json_object mode when asked", async () => {
  mockCreate.mockResolvedValue({ choices: [{ message: { content: "{\"tool\":\"final\",\"response\":\"hi\"}" } }] });
  await localLlmService.loadEngine("Qwen3-1.7B-q4f16_1-MLC");
  const out = await localLlmService.generate(
    [{ role: "user", content: "hello" }], { jsonMode: true }
  );
  expect(out).toBe("{\"tool\":\"final\",\"response\":\"hi\"}");
  expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({
    temperature: 0,
    max_tokens: 1024,
    response_format: { type: "json_object" },
  }));
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

it("keeps only the second model's engine when models are switched mid-load (DAVAI-126 I1)", async () => {
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

it("does not announce ready when unloaded mid-load (DAVAI-126 I1)", async () => {
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
