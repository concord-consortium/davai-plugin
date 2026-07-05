import { createLocalLlmWorker } from "./local-llm-worker-factory";

export interface IChatMsg { role: "system" | "user" | "assistant"; content: string; }
export type LocalLlmStatus = "idle" | "loading" | "ready" | "error";
export interface ILocalLlmLoadState {
  status: LocalLlmStatus;
  modelId?: string;
  progress?: number;
  text?: string;
  error?: string;
}

// The MLCEngine type is only needed structurally; keep it loose so the heavy library
// stays behind the dynamic import below.
interface IEngineLike {
  chat: { completions: { create: (req: any) => Promise<any> } };
  interruptGenerate: () => void;
  unload: () => Promise<void>;
}

let engine: IEngineLike | null = null;
let loadPromise: Promise<void> | null = null;
let loadedModelId: string | null = null;
let state: ILocalLlmLoadState = { status: "idle" };
const listeners = new Set<(s: ILocalLlmLoadState) => void>();

const setState = (next: ILocalLlmLoadState) => {
  state = next;
  listeners.forEach((cb) => cb(state));
};

const doLoad = async (modelId: string) => {
  setState({ status: "loading", modelId, progress: 0 });
  // Dynamic import keeps @mlc-ai/web-llm out of the main bundle until a Local model
  // is actually selected (it becomes an async webpack chunk).
  const { CreateWebWorkerMLCEngine } = await import("@mlc-ai/web-llm");
  engine = await CreateWebWorkerMLCEngine(
    createLocalLlmWorker(),
    modelId,
    {
      initProgressCallback: (p: { progress: number; text: string }) => {
        setState({ status: "loading", modelId, progress: p.progress, text: p.text });
      },
    },
    // Prebuilt Qwen3 configs default to a 4096 window — too small for the mirrored
    // DAVAI context, so override to 8K (KV-cache cost is acceptable for both models).
    { context_window_size: 8192 }
  ) as unknown as IEngineLike;
  loadedModelId = modelId;
  setState({ status: "ready", modelId });
};

export const localLlmService = {
  isWebGPUAvailable(): boolean {
    return typeof navigator !== "undefined" && !!(navigator as any).gpu;
  },
  getLoadState(): ILocalLlmLoadState {
    return state;
  },
  onLoadStateChange(cb: (s: ILocalLlmLoadState) => void): () => void {
    listeners.add(cb);
    return () => listeners.delete(cb);
  },
  async loadEngine(modelId: string): Promise<void> {
    if (loadedModelId === modelId && state.status === "ready") return;
    if (loadPromise && state.modelId === modelId) return loadPromise;
    if (engine) await this.unload();
    loadPromise = doLoad(modelId).catch((err) => {
      engine = null;
      loadedModelId = null;
      setState({ status: "error", modelId, error: err instanceof Error ? err.message : String(err) });
      throw err;
    }).finally(() => { loadPromise = null; });
    return loadPromise;
  },
  async generate(messages: IChatMsg[], opts?: { jsonMode?: boolean }): Promise<string> {
    if (!engine) throw new Error("Local model is not loaded.");
    const reply = await engine.chat.completions.create({
      messages,
      temperature: 0,
      max_tokens: 1024,
      ...(opts?.jsonMode ? { response_format: { type: "json_object" } } : {}),
    });
    return reply?.choices?.[0]?.message?.content ?? "";
  },
  interrupt(): void {
    engine?.interruptGenerate();
  },
  async unload(): Promise<void> {
    const e = engine;
    engine = null;
    loadedModelId = null;
    if (e) await e.unload();
    setState({ status: "idle" });
  },
};
