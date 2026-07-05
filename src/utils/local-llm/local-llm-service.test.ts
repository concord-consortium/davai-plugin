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
