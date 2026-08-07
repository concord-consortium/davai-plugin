// Latency runner for the done-loop (metric #2). Drives the interaction suite against
// a backend, timing each logical interaction end-to-end (a message plus any tool
// round-trips through to the final response), and reports mean/p50/p95 — overall and
// split by the tool-calling bucket.
//
// Drivers:
//   ws           new stack over WebSocket (default)      --transport ws   --url ws://host/ws
//   invocations  new stack over HTTP /invocations         --transport invocations --url http://host
//   sam-poll     OLD stack (sam-server): POST /message + poll /status (the baseline)
//                --transport sam-poll --url https://<api-gw-base>/  --auth <token>
//
// Node 22+ provides global fetch + WebSocket, so this file has no dependencies.
// Usage: node run.mjs --transport ws --url ws://127.0.0.1:8770/ws --runs 20 [--only id1,id2] [--auth TOKEN]

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const suite = JSON.parse(fs.readFileSync(path.resolve(dir, "../suite/interactions.json"), "utf8"));

const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
};
const transport = arg("transport", "ws");
const url = arg("url", "ws://127.0.0.1:8770/ws");
const runs = parseInt(arg("runs", "20"), 10);
const only = arg("only", "");
const auth = arg("auth", process.env.AUTH_TOKEN || "");
const llmId = JSON.stringify({ id: arg("model", "gpt-4o-mini"), provider: "OpenAI" });

const TOOL_RESULT = "The requested CODAP operation completed successfully.";
const ctx = suite.fixture?.attributes
  ? [{ name: "Mammals", collections: [{ name: "Cases", attrs: suite.fixture.attributes.map((n) => ({ name: n })) }] }]
  : [];

let interactions = suite.interactions;
if (only) interactions = interactions.filter((it) => only.split(",").includes(it.id));

const pct = (arr, p) => {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};
const mean = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;

// ---- drivers: each runs ONE logical interaction and returns elapsed ms ----

async function wsTurn(ws, frame) {
  return new Promise((resolve, reject) => {
    ws.onmessage = (ev) => {
      const f = JSON.parse(ev.data.toString());
      if (f.type === "result") resolve(f.output);
      else if (f.type === "error") reject(new Error(f.error));
    };
    ws.send(JSON.stringify(frame));
  });
}
async function runWs(it, threadId, t0) {
  const ws = new WebSocket(auth ? `${url}?token=${encodeURIComponent(auth)}` : url);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error("ws open failed")); });
  let out = await wsTurn(ws, { llmId, threadId, message: it.prompt, dataContexts: ctx, graphs: [] });
  while (out?.status === "requires_action" && out.tool_call_id) {
    out = await wsTurn(ws, { kind: "tool", llmId, threadId, message: { tool_call_id: out.tool_call_id, content: TOOL_RESULT } });
  }
  ws.close();
  return performance.now() - t0;
}

async function postInvocations(body) {
  const r = await fetch(`${url.replace(/\/$/, "")}/invocations`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(auth ? { authorization: auth } : {}) },
    body: JSON.stringify(body),
  });
  return r.json();
}
async function runInvocations(it, threadId, t0) {
  let out = await postInvocations({ llmId, threadId, message: it.prompt, dataContexts: ctx, graphs: [] });
  while (out?.status === "requires_action" && out.tool_call_id) {
    out = await postInvocations({ kind: "tool", llmId, threadId, message: { tool_call_id: out.tool_call_id, content: TOOL_RESULT } });
  }
  return performance.now() - t0;
}

// OLD stack (sam-server): submit a job then poll status until completed, looping tool calls.
async function samSubmit(endpoint, body) {
  const r = await fetch(`${url.replace(/\/$/, "")}/default/davaiServer/${endpoint}`, {
    method: "POST", headers: { "content-type": "application/json", authorization: auth }, body: JSON.stringify(body),
  });
  return (await r.json()).messageId;
}
async function samPoll(messageId) {
  for (;;) {
    const r = await fetch(`${url.replace(/\/$/, "")}/default/davaiServer/status?messageId=${messageId}`, { method: "GET" });
    const { status, output } = await r.json();
    if (status === "completed") return output;
    if (status === "error" || status === "cancelled") throw new Error(status);
    await new Promise((res) => setTimeout(res, status === "streaming" ? 500 : 1000));
  }
}
async function runSamPoll(it, threadId, t0) {
  let out = await samPoll(await samSubmit("message", { llmId, threadId, message: it.prompt, dataContexts: ctx, graphs: [] }));
  while (out?.status === "requires_action" && out.tool_call_id) {
    out = await samPoll(await samSubmit("tool", { llmId, threadId, message: { tool_call_id: out.tool_call_id, content: TOOL_RESULT } }));
  }
  return performance.now() - t0;
}

const drivers = { ws: runWs, invocations: runInvocations, "sam-poll": runSamPoll };
const driver = drivers[transport];
if (!driver) { console.error(`unknown --transport ${transport}`); process.exit(2); }

// ---- run ----
console.log(`latency: transport=${transport} url=${url} runs=${runs} interactions=${interactions.length}`);
const perInteraction = [];
for (const it of interactions) {
  const times = [];
  for (let i = 0; i < runs; i++) {
    const threadId = `t-lat-${it.id}-${i}`.padEnd(36, "0");
    const t0 = performance.now();
    try {
      times.push(await driver(it, threadId, t0));
    } catch (e) {
      console.error(`  ${it.id} run ${i} FAILED: ${e.message}`);
    }
  }
  if (!times.length) continue;
  const row = { id: it.id, cls: it.class, tool: !!it.toolCalling, n: times.length, mean: mean(times), p50: pct(times, 50), p95: pct(times, 95) };
  perInteraction.push(row);
  console.log(`  ${row.id.padEnd(34)} n=${row.n} mean=${row.mean.toFixed(0)}ms p50=${row.p50.toFixed(0)}ms p95=${row.p95.toFixed(0)}ms`);
}

const all = perInteraction.flatMap((r) => Array(r.n).fill(r.p50)); // approx pool by p50
const toolRows = perInteraction.filter((r) => r.tool);
const summarize = (rows, label) => {
  if (!rows.length) return;
  const p50s = rows.map((r) => r.p50);
  console.log(`${label}: p50-of-p50s=${pct(p50s, 50).toFixed(0)}ms  mean-of-means=${mean(rows.map((r) => r.mean)).toFixed(0)}ms  (${rows.length} interactions)`);
};
console.log("---");
summarize(perInteraction, "OVERALL");
summarize(toolRows, "TOOL-CALLING");
fs.writeFileSync(path.resolve(dir, `results-${transport}.json`), JSON.stringify({ transport, url, runs, perInteraction }, null, 2));
console.log(`wrote results-${transport}.json`);
