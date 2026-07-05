// Isolated in its own module because `import.meta.url` cannot be parsed by ts-jest's CJS
// transform — tests mock this module and never load it.
export const createLocalLlmWorker = (): Worker =>
  new Worker(new URL("./local-llm-worker.ts", import.meta.url), { type: "module" });
