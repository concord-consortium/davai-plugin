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
// Two model-id trackers with different lifetimes: `loadedModelId` names the model whose engine
// is actually resident (set only once an engine finishes loading, cleared on unload), and it
// gates the idempotent early-return in loadEngine. `state.modelId` echoes whatever load is in
// progress (set the moment a load starts, before the engine exists) and drives the UI's
// loading/ready announcements. They diverge during a load and while switching models.
let loadedModelId: string | null = null;
// Monotonic load generation. loadEngine and unload both bump it; doLoad captures its value and
// re-checks after every await, so a load that was superseded (a newer load started, or unload
// was called) can abandon its just-created engine instead of clobbering the current state or
// leaking GBs of resident model. Guards the loadEngine race where model A is still downloading
// (engine null) when loadEngine(B) starts a second concurrent doLoad.
let loadGeneration = 0;
let state: ILocalLlmLoadState = { status: "idle" };
const listeners = new Set<(s: ILocalLlmLoadState) => void>();

const setState = (next: ILocalLlmLoadState) => {
  state = next;
  listeners.forEach((cb) => cb(state));
};

const doLoad = async (modelId: string, generation: number) => {
  const isStale = () => generation !== loadGeneration;
  setState({ status: "loading", modelId, progress: 0 });
  // Dynamic import keeps @mlc-ai/web-llm out of the main bundle until a Local model
  // is actually selected (it becomes an async webpack chunk).
  const { CreateWebWorkerMLCEngine } = await import("@mlc-ai/web-llm");
  if (isStale()) return; // superseded during the import
  const created = await CreateWebWorkerMLCEngine(
    createLocalLlmWorker(),
    modelId,
    {
      initProgressCallback: (p: { progress: number; text: string }) => {
        // Drop progress from a superseded load so it can't overwrite the current load's state.
        if (isStale()) return;
        setState({ status: "loading", modelId, progress: p.progress, text: p.text });
      },
    },
    // Prebuilt Qwen3 configs default to a 4096 window — too small for the mirrored
    // DAVAI context, so override to 8K (KV-cache cost is acceptable for both models).
    { context_window_size: 8192 }
  ) as unknown as IEngineLike;
  if (isStale()) {
    // A newer load started (or unload was called) while this engine was being built. Tear it
    // down rather than adopting it: the winner owns `engine`/`state`, and adopting this one
    // would leak the winner's engine and/or resurrect a stale "ready" announcement.
    await created.unload().catch(() => undefined);
    return;
  }
  engine = created;
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
    // Claim a fresh generation for this load; any earlier in-flight doLoad is now stale.
    const generation = ++loadGeneration;
    loadPromise = doLoad(modelId, generation).catch((err) => {
      // Only the current load may publish an error / reset shared state; a stale load that
      // rejected after being superseded must stay silent.
      if (generation === loadGeneration) {
        engine = null;
        loadedModelId = null;
        setState({ status: "error", modelId, error: err instanceof Error ? err.message : String(err) });
      }
      throw err;
    }).finally(() => {
      if (generation === loadGeneration) loadPromise = null;
    });
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
    // Bump the generation so any in-flight doLoad abandons its engine instead of announcing
    // ready after this unload.
    loadGeneration++;
    const e = engine;
    engine = null;
    loadedModelId = null;
    if (e) await e.unload();
    setState({ status: "idle" });
  },
};
