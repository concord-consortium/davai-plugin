// Local SigV4 bridge: lets the browser client talk to the DEPLOYED AgentCore runtime.
//
// The client's WebSocket transport (src/utils/ws-transport.ts) can't reach the deployed
// runtime directly — AgentCore's data plane only accepts SigV4-signed InvokeAgentRuntime
// calls, which a browser can't produce. This bridge speaks the backend's WS frame
// protocol (backend/src/ws.ts) on localhost and forwards each turn via the AWS SDK,
// requesting `text/event-stream` so the container's SSE frames (sentence-boundary
// {type:"token"} events, then {type:"result"}) are relayed to the client as they arrive.
// If the container answers with plain JSON (an image without SSE support), the full
// body is delivered as a single {type:"result"} frame instead.
//
// Credentials come from `aws configure export-credentials --profile agentcore`, so the
// `aws login` browser session (and its refresh token) keeps working; the bridge
// re-exports automatically shortly before expiry.
//
// Usage:
//   node scripts/agentcore-bridge.mjs [--port 8100] [--arn <runtime-arn>] [--profile agentcore]
// then set WS_SERVER_URL=ws://localhost:8100/ws in .env and restart the dev server.
//
// Remaining limitations vs. the local backend container:
// - { type: "seed" } (transcript re-seed) is acknowledged but NOT forwarded: the deployed
//   /invocations endpoint only accepts turn inputs. Conversation memory instead lives in
//   the microVM pinned to the runtime session (derived from threadId below).
// - { type: "cancel" } aborts the HTTP call; the server-side turn still runs to
//   completion on the microVM (its result is discarded).

import { WebSocketServer } from "ws";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createRequire } from "node:module";

// The SDK client lives in backend/node_modules (a backend devDependency).
const require = createRequire(new URL("../backend/package.json", import.meta.url));
const { BedrockAgentCoreClient, InvokeAgentRuntimeCommand } = require("@aws-sdk/client-bedrock-agentcore");
const ex = promisify(execFile);

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; };
const PORT = parseInt(arg("port", "8100"), 10);
const ARN = arg("arn", "arn:aws:bedrock-agentcore:us-east-1:816253370536:runtime/davai_agentcore-0c9quSDd49");
const REGION = arg("region", "us-east-1");
const PROFILE = arg("profile", process.env.AWS_PROFILE || "agentcore");

// Credential provider backed by the AWS CLI (supports `aws login` sessions). The SDK
// re-invokes this when the returned expiration approaches.
async function cliCredentials() {
  const { stdout } = await ex("aws", ["configure", "export-credentials", "--profile", PROFILE]);
  const c = JSON.parse(stdout);
  return {
    accessKeyId: c.AccessKeyId,
    secretAccessKey: c.SecretAccessKey,
    sessionToken: c.SessionToken,
    expiration: c.Expiration ? new Date(c.Expiration) : undefined,
  };
}

const client = new BedrockAgentCoreClient({ region: REGION, credentials: cliCredentials });

// AgentCore runtime session ids must be >= 33 chars; derive a stable one from threadId
// so every turn of a client thread lands on the same pinned microVM.
const sessionIdFor = (threadId) => `sess-${String(threadId)}`.padEnd(36, "0").slice(0, 100);

// Feed SSE bytes in; invoke onFrame with each complete `data: {...}` event's parsed JSON.
function sseParser(onFrame) {
  let buf = "";
  return (chunkText) => {
    buf += chunkText;
    let sep;
    while ((sep = buf.indexOf("\n\n")) >= 0) {
      const block = buf.slice(0, sep);
      buf = buf.slice(sep + 2);
      const data = block
        .split("\n")
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trimStart())
        .join("\n");
      if (!data) continue;
      try { onFrame(JSON.parse(data)); } catch { /* ignore malformed event */ }
    }
  };
}

const wss = new WebSocketServer({ port: PORT, path: "/ws" });

wss.on("connection", (ws) => {
  const send = (obj) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj)); };
  let inflight = null; // AbortController of the current turn

  ws.on("message", async (raw) => {
    let frame;
    try {
      frame = JSON.parse(raw.toString());
    } catch {
      return send({ type: "error", error: "invalid JSON frame" });
    }

    if (frame?.type === "cancel") {
      // Mirror the real backend (runner.ts returns {status:"cancelled"} on abort, ws.ts
      // sends it as a result frame): the client's suspended turn must RESOLVE, not hang.
      // The deployed microVM still runs its turn to completion; the result is discarded.
      if (inflight) {
        inflight.abort();
        inflight = null;
        send({ type: "result", output: { status: "cancelled" } });
      }
      return;
    }

    if (frame?.type === "seed") {
      console.warn(`[bridge] seed frame ignored (deployed /invocations cannot re-seed; relying on microVM session memory)`);
      return send({ type: "seeded", count: 0 });
    }

    inflight?.abort(); // supersede any prior in-flight turn on this socket
    const controller = new AbortController();
    inflight = controller;
    const t0 = performance.now();
    let tokens = 0;

    try {
      const out = await client.send(new InvokeAgentRuntimeCommand({
        agentRuntimeArn: ARN,
        runtimeSessionId: sessionIdFor(frame.threadId),
        contentType: "application/json",
        accept: "text/event-stream",
        payload: JSON.stringify(frame),
      }), { abortSignal: controller.signal });

      const streaming = (out.contentType || "").includes("text/event-stream");
      if (streaming) {
        const feed = sseParser((evt) => {
          if (evt?.type === "token") tokens++;
          send(evt); // token / result / error frames pass through unchanged
        });
        for await (const chunk of out.response) feed(Buffer.from(chunk).toString("utf8"));
      } else {
        const parts = [];
        for await (const chunk of out.response) parts.push(Buffer.from(chunk));
        send({ type: "result", output: JSON.parse(Buffer.concat(parts).toString("utf8")) });
      }
      console.log(`[bridge] turn ${frame.kind === "tool" ? "(tool) " : ""}thread=${frame.threadId} ${(performance.now() - t0).toFixed(0)}ms ${streaming ? `(${tokens} token frames)` : "(no stream)"}`);
    } catch (e) {
      if (controller.signal.aborted) return; // cancelled locally; drop silently
      console.error(`[bridge] invoke failed:`, e?.message || e);
      send({ type: "error", error: e?.message || String(e) });
    } finally {
      if (inflight === controller) inflight = null;
    }
  });

  ws.on("close", () => inflight?.abort());
});

console.log(`agentcore-bridge listening on ws://localhost:${PORT}/ws`);
console.log(`  forwarding to ${ARN} (region ${REGION}, profile ${PROFILE}, SSE requested)`);
