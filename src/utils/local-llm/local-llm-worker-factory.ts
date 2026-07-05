// Isolated in its own module because `import.meta.url` cannot be parsed by ts-jest's CJS
// transform — tests mock this module and never load it.
//
// No `{ type: "module" }` here: webpack's worker chunk loading emits a CLASSIC worker
// regardless (output.module is false for this build), compiling away the ESM in the worker
// source and having its vendor chunk load via `importScripts(...)` — something a module
// worker would forbid. Do not reintroduce `type: "module"` without also reconfiguring
// webpack's worker chunk loading to match.
export const createLocalLlmWorker = (): Worker =>
  new Worker(new URL("./local-llm-worker.ts", import.meta.url));
