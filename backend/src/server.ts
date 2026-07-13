// AgentCore bring-your-own-container HTTP server.
//
// Implements the AgentCore Runtime service contract:
//   GET  /ping         -> health check (200)
//   POST /invocations  -> run one turn, return the client-facing output JSON
// on port 8080. The WebSocket endpoint (/ws) and SSE streaming are added in P3;
// for P2 this returns the final turn result synchronously (agent parity first).

import "dotenv/config";
import http from "node:http";
import { runTurn } from "./runner.js";
import { validateTurn } from "./validate.js";
import { attachWebSocket } from "./ws.js";
import type { TurnInput } from "./types.js";

const PORT = Number(process.env.PORT || 8080);
const HOST = "0.0.0.0";
const MAX_BODY_BYTES = 100 * 1024 * 1024; // AgentCore payload cap is 100 MB
const AUTH_SECRET = process.env.DAVAI_API_SECRET; // optional shared bearer (parity with old server)

// OLD-transport reproduction (DAVAI_OLD_MODE=1): the pre-AgentCore client-visible
// behavior — POST /message returns 202 + a messageId, the client polls /status until
// completed, and a tool call is a SECOND queued job. Same LangGraph agent. Used only
// by the done-loop to measure the poll/queue overhead this project removes. (It uses
// the in-VM checkpointer, so it EXCLUDES the old stack's Postgres serialization — the
// real old-vs-new gap is therefore at least this large.)
const OLD_MODE = process.env.DAVAI_OLD_MODE === "1";
const oldJobs = new Map<string, { status: string; output: any }>();
let oldJobSeq = 0;

async function processOldJob(messageId: string, input: any) {
  const job = oldJobs.get(messageId)!;
  try {
    const output = await runTurn(input, {
      onToken: (text: string) => {
        job.status = "streaming";
        job.output = { response: text };
      },
    });
    job.status = "completed";
    job.output = output;
  } catch (e) {
    job.status = "error";
    job.output = { error: e instanceof Error ? e.message : String(e) };
  }
}

// CORS: the browser client is a cross-origin caller (served from a different origin
// than the backend). The old API Gateway used `*`; mirror that here.
const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "authorization, content-type",
};

function send(res: http.ServerResponse, status: number, body: unknown) {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(json),
    ...CORS_HEADERS,
  });
  res.end(json);
}

function readJsonBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("payload too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function authorized(req: http.IncomingMessage): boolean {
  if (!AUTH_SECRET) return true; // no secret configured => open (local dev)
  const header = req.headers["authorization"];
  // The DAVAI client sends the token verbatim (no "Bearer " prefix).
  return header === AUTH_SECRET || header === `Bearer ${AUTH_SECRET}`;
}

const server = http.createServer(async (req, res) => {
  try {
    // CORS preflight
    if (req.method === "OPTIONS") {
      res.writeHead(204, CORS_HEADERS);
      return res.end();
    }

    if (req.method === "GET" && (req.url === "/ping" || req.url?.startsWith("/ping?"))) {
      return send(res, 200, { status: "Healthy" });
    }

    // OLD-transport routes (poll/queue), used only when DAVAI_OLD_MODE=1.
    if (OLD_MODE) {
      const u = new URL(req.url || "/", "http://localhost");
      const p = u.pathname;
      if (req.method === "POST" && (p === "/default/davaiServer/message" || p === "/default/davaiServer/tool")) {
        if (!authorized(req)) return send(res, 401, { error: "unauthorized" });
        let body: any;
        try { body = await readJsonBody(req); } catch (e) { return send(res, 400, { error: (e as Error).message }); }
        const isTool = p.endsWith("/tool");
        const invalid = validateTurn(isTool ? { ...body, kind: "tool" } : body);
        if (invalid) return send(res, 400, { error: invalid });
        const messageId = `${isTool ? "t" : "m"}${Date.now()}-${oldJobSeq++}`;
        oldJobs.set(messageId, { status: "queued", output: null });
        void processOldJob(messageId, isTool ? { ...body, kind: "tool" } : body);
        return send(res, 202, { messageId, status: "queued" });
      }
      if (req.method === "GET" && p === "/default/davaiServer/status") {
        const messageId = u.searchParams.get("messageId") || "";
        const job = oldJobs.get(messageId);
        if (!job) return send(res, 404, { error: "job not found" });
        return send(res, 200, { status: job.status, output: job.output });
      }
      return send(res, 404, { error: "not found" });
    }

    if (req.method === "POST" && req.url === "/invocations") {
      if (!authorized(req)) return send(res, 401, { error: "unauthorized" });

      let body: any;
      try {
        body = await readJsonBody(req);
      } catch (e) {
        return send(res, 400, { error: (e as Error).message });
      }

      const invalid = validateTurn(body);
      if (invalid) return send(res, 400, { error: invalid });

      try {
        const output = await runTurn(body as TurnInput);
        return send(res, 200, output);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        console.error("Turn failed:", message);
        return send(res, 500, { error: message });
      }
    }

    return send(res, 404, { error: "not found" });
  } catch (e) {
    return send(res, 500, { error: (e as Error).message });
  }
});

// WebSocket transport (P3): streams tokens + collapses the client tool round-trip.
// Not attached in OLD_MODE (that server only speaks the legacy poll/queue routes).
if (!OLD_MODE) attachWebSocket(server);

server.listen(PORT, HOST, () => {
  const routes = OLD_MODE
    ? "OLD-MODE: /ping, POST /default/davaiServer/{message,tool}, GET /status"
    : "/ping, /invocations, ws://.../ws";
  console.log(`davai-agentcore backend listening on http://${HOST}:${PORT}  (${routes})`);
});
