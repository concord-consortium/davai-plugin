// AgentCore bring-your-own-container HTTP server.
//
// Implements the AgentCore Runtime service contract:
//   GET  /ping         -> health check (200)
//   POST /invocations  -> run one turn, return the client-facing output JSON
// on port 8080. /invocations returns the turn synchronously, or streams SSE when
// the caller sends Accept: text/event-stream; /ws (ws.ts) is the WebSocket transport.

import "dotenv/config";
import http from "node:http";
import { runTurn } from "./runner.js";
import { validateTurn } from "./validate.js";
import { attachWebSocket } from "./ws.js";
import type { TurnInput } from "./types.js";

const PORT = Number(process.env.PORT || 8080);
const HOST = "0.0.0.0";
// AgentCore's own payload cap is 100 MB; DAVAI turn inputs (message + dataContexts +
// graphs) are far smaller, and the runtime is invocable anonymously — keep the cap tight.
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const AUTH_SECRET = process.env.DAVAI_API_SECRET; // optional shared bearer (parity with old server)

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

      // SSE streaming (opt-in via Accept, passed through by AgentCore's `accept`
      // invoke parameter): emit the same frames the WebSocket transport uses —
      // {type:"token"} at each shouldFlush boundary, then a terminal {type:"result"}.
      // Callers that don't ask for event-stream get the original synchronous JSON.
      if ((req.headers.accept || "").includes("text/event-stream")) {
        res.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          connection: "keep-alive",
          ...CORS_HEADERS,
        });
        // Stop the (paid) turn if the client goes away mid-stream, and never write
        // to a closed response.
        const controller = new AbortController();
        res.on("close", () => controller.abort());
        const emit = (obj: unknown) => {
          if (!res.writableEnded && !controller.signal.aborted) {
            res.write(`data: ${JSON.stringify(obj)}\n\n`);
          }
        };
        try {
          const output = await runTurn(body as TurnInput, {
            signal: controller.signal,
            onToken: (text: string) => emit({ type: "token", text }),
          });
          emit({ type: "result", output });
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          console.error("Turn failed:", message);
          emit({ type: "error", error: message });
        }
        return res.end();
      }

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

// WebSocket transport: streams tokens + collapses the client tool round-trip.
attachWebSocket(server);

server.listen(PORT, HOST, () => {
  console.log(`davai-agentcore backend listening on http://${HOST}:${PORT}  (/ping, /invocations, ws://.../ws)`);
});
