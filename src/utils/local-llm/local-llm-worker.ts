import { WebWorkerMLCEngineHandler } from "@mlc-ai/web-llm";

// The WebLLM engine lives in this worker: model download, WebGPU compilation, and token
// generation all happen off the main thread so sonification audio and screen-reader
// interaction stay responsive.
const handler = new WebWorkerMLCEngineHandler();
self.onmessage = (msg: MessageEvent) => handler.onmessage(msg);
