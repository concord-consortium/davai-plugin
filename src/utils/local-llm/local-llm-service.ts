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

// Watchdog timeout for a single generate() call. Generous on purpose: a 16K-token prefill on a
// weak GPU can legitimately take minutes. This exists to rescue a hung engine call (see the
// response_format removal below), not to police normal latency.
const GENERATE_TIMEOUT_MS = 300_000;

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
// The currently in-flight load's worker, tracked so a superseding claim (a new loadEngine, or
// unload()) can terminate it immediately instead of letting a 1-2 GB download/compilation run to
// completion in a live worker before being discarded by the isStale() checks below. `settle`
// resolves (never rejects) that load's own promise the moment it is superseded: callers
// re-validate their epoch right after the load (the turn path re-checks isCurrent(), and App's
// loadEngine().catch(...) must not fire a spurious "failed to load" for a mere supersession).
let inflightLoad: { generation: number; worker: Worker; settle: () => void } | null = null;
let state: ILocalLlmLoadState = { status: "idle" };
const listeners = new Set<(s: ILocalLlmLoadState) => void>();

const setState = (next: ILocalLlmLoadState) => {
  state = next;
  listeners.forEach((cb) => cb(state));
};

// If an older-generation load is still in flight, terminate its worker right away and resolve
// its promise (not reject — see `inflightLoad` comment above) so it stops occupying GPU/WASM
// resources instead of running to completion unobserved. Called both when a new load claims the
// generation and from unload(). A no-op if the in-flight load already belongs to `generation` or
// there is none.
const terminateInflightIfSuperseded = (generation: number) => {
  if (inflightLoad && inflightLoad.generation !== generation) {
    inflightLoad.worker.terminate();
    inflightLoad.settle();
    inflightLoad = null;
  }
};

const doLoad = async (modelId: string, generation: number, onSettleEarly: () => void) => {
  const isStale = () => generation !== loadGeneration;
  setState({ status: "loading", modelId, progress: 0 });
  // Dynamic import keeps @mlc-ai/web-llm out of the main bundle until a Local model
  // is actually selected (it becomes an async webpack chunk).
  const { CreateWebWorkerMLCEngine } = await import("@mlc-ai/web-llm");
  if (isStale()) return; // superseded during the import

  // Create the worker before the engine call and register it as this generation's in-flight
  // load so a superseding claim can terminate it immediately (see terminateInflightIfSuperseded).
  // Termination calls `onSettleEarly`, which resolves the OUTER loadEngine()-facing promise early
  // (wired up by the caller in loadEngine) — it does not interrupt this function. This doLoad
  // body keeps running underneath and still reaches the isStale() check below if/when
  // CreateWebWorkerMLCEngine eventually settles on its own, which remains the backstop for
  // tearing down a late-arriving engine.
  const worker = createLocalLlmWorker();
  inflightLoad = { generation, worker, settle: onSettleEarly };

  const created = await CreateWebWorkerMLCEngine(
    worker,
    modelId,
    {
      initProgressCallback: (p: { progress: number; text: string }) => {
        // Drop progress from a superseded load so it can't overwrite the current load's state.
        if (isStale()) return;
        setState({ status: "loading", modelId, progress: p.progress, text: p.text });
      },
    },
    // Prebuilt Qwen3 configs default to a 4096 window — too small even for the focused-tools
    // prompt, so override to 8K: the generated tool docs + schema digest + graph seed assemble
    // to roughly 3K tokens, so 8K leaves ample headroom for the transcript and a multi-round
    // tool loop without the model ever seeing ContextWindowSizeExceededError. It also halves
    // KV-cache VRAM versus the prior 16K window (roughly -1 GB for the 1.7B model and -1.2 GB
    // for the 4B model), which matters on weaker GPUs. Qwen3's native window is 32K, so 8K is
    // well within range.
    { context_window_size: 8192 }
  ) as unknown as IEngineLike;
  // Clear our own inflightLoad registration now that we have an engine (nothing left to
  // terminate); a superseding claim that arrives after this point tears down `created` via the
  // isStale() branch below instead of via terminateInflightIfSuperseded.
  if (inflightLoad && inflightLoad.generation === generation) inflightLoad = null;

  if (isStale()) {
    // A newer load started (or unload was called) while this engine was being built — either
    // caught here on first arrival, or (if terminateInflightIfSuperseded already ran) this is the
    // backstop for a terminated worker whose CreateWebWorkerMLCEngine call settled anyway. Tear it
    // down rather than adopting it: the winner owns `engine`/`state`, and adopting this one would
    // leak the winner's engine and/or resurrect a stale "ready" announcement.
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
    // If a load from an older generation is still in flight (e.g. still downloading with no
    // resident `engine` yet, so the `if (engine)` branch above didn't run unload()), terminate
    // its worker now instead of leaving it to run to completion before isStale() discards it.
    terminateInflightIfSuperseded(generation);

    // Resolved early (never rejected) if THIS load is itself superseded before it finishes: a
    // mere supersession must read as success to callers (they re-validate their own epoch), not
    // as a load failure. Racing it against the real doLoad(...) below lets the caller-facing
    // promise settle immediately on termination without waiting on (or being coupled to) whatever
    // doLoad's own execution — which keeps running underneath — eventually does.
    let resolveEarly: () => void = () => undefined;
    const settledEarly = new Promise<void>((resolve) => { resolveEarly = resolve; });
    const settling = doLoad(modelId, generation, resolveEarly).catch((err) => {
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
    loadPromise = Promise.race([settledEarly, settling]);
    // If `settledEarly` wins the race (this load was superseded) and `settling` goes on to
    // reject anyway (e.g. the terminated worker's CreateWebWorkerMLCEngine call settles with an
    // error), that rejection is already unobservable to callers and must not become an unhandled
    // promise rejection. The `.catch` above already handles the "publish an error" side effect
    // for the still-current case; this just silences the promise itself.
    settling.catch(() => undefined);
    return loadPromise;
  },
  async generate(messages: IChatMsg[], opts?: { maxTokens?: number }): Promise<string> {
    if (!engine) throw new Error("Local model is not loaded.");
    // No response_format here: @mlc-ai/web-llm 0.2.84 routes a schema-less
    // response_format: {type:"json_object"} straight into compileJSONSchema(undefined), which
    // raises a wasm BindingError ("Cannot pass non-string to std::string") as an uncaught
    // rejection inside the worker — it never reaches this promise, so the turn just hangs
    // forever. The envelope parser + one-retry loop in local-llm-loop.ts were designed to
    // survive unconstrained model output, so run unconstrained here. A VERIFIED schema/EBNF
    // grammar constraint (once 0.2.84's bug is worked around or a fixed version is available)
    // is a named follow-up, not done here.
    const create = engine.chat.completions.create({
      messages,
      temperature: 0,
      max_tokens: opts?.maxTokens ?? 1024,
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        // Defensive: ask the engine to stop generating even though nothing reads the result of
        // this call — if the hang is caused by the 0.2.84 worker-side rejection, the worker may
        // already be wedged and interruptGenerate() may itself be a no-op, but it's free to try.
        engine?.interruptGenerate();
        reject(new Error("local model generation timed out"));
      }, GENERATE_TIMEOUT_MS);
    });
    try {
      const reply = await Promise.race([create, timeout]);
      return reply?.choices?.[0]?.message?.content ?? "";
    } finally {
      // Clear the timer regardless of which side of the race settled, so a resolved/rejected
      // generate() never leaves a dangling timer behind (matters for tests using fake timers,
      // and avoids an unnecessary interruptGenerate() firing after the call already finished).
      clearTimeout(timer);
    }
  },
  interrupt(): void {
    engine?.interruptGenerate();
  },
  async unload(): Promise<void> {
    // Bump the generation so any in-flight doLoad abandons its engine instead of announcing
    // ready after this unload.
    loadGeneration++;
    // Terminate (rather than let run to completion) any load still in flight under the old
    // generation, and resolve its promise so it doesn't hang.
    terminateInflightIfSuperseded(loadGeneration);
    const e = engine;
    engine = null;
    loadedModelId = null;
    if (e) await e.unload();
    setState({ status: "idle" });
  },
};
