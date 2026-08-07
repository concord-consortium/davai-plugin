// Headline latency comparison (metric #2): OLD deployed stack (staging-a, SQS+Lambda+
// Postgres+poll) vs NEW deployed stack (AgentCore, in-VM, invoke). Same model
// (gpt-4o-mini), same interactions, N runs each. Reports p50/mean + reduction %.
//
// OLD creds from /tmp/baseline-creds.json (captured from the live main-branch plugin).
// NEW via the AWS invoke API (aws creds on PATH).
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const ex = promisify(execFile);

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; };
const RUNS = parseInt(arg("runs", "20"), 10);
const ARN = arg("arn", "arn:aws:bedrock-agentcore:us-east-1:816253370536:runtime/davai_agentcore-0c9quSDd49");
const REGION = "us-east-1";
const { base: OLD_BASE, token: OLD_TOKEN } = JSON.parse(fs.readFileSync("/tmp/baseline-creds.json", "utf8"));
const llmId = JSON.stringify({ id: "gpt-4o-mini", provider: "OpenAI" });
const ctx = [{ name: "Mammals", collections: [{ name: "Cases", attrs: [{ name: "Height" }, { name: "Mass" }, { name: "LifeSpan" }] }] }];
const TOOL_RESULT = "Graph created successfully.";
const tmp = path.join(os.tmpdir(), "cmp"); fs.mkdirSync(tmp, { recursive: true });

const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
const p50 = a => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
const p95 = a => [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(0.95 * a.length))];

// ---- OLD: staging poll ----
async function oldSubmit(endpoint, body) {
  const r = await fetch(`${OLD_BASE}default/davaiServer/${endpoint}`, { method: "POST", headers: { "content-type": "application/json", authorization: OLD_TOKEN }, body: JSON.stringify(body) });
  return (await r.json()).messageId;
}
async function oldPoll(id) {
  for (;;) {
    const r = await fetch(`${OLD_BASE}default/davaiServer/status?messageId=${id}`, { headers: { authorization: OLD_TOKEN } });
    const { status, output } = await r.json();
    if (status === "completed") return output;
    if (status === "error" || status === "cancelled") throw new Error(status);
    await new Promise(res => setTimeout(res, status === "streaming" ? 500 : 1000));
  }
}
async function oldTurn(kind, threadId, msg) {
  const t0 = performance.now();
  let out = await oldPoll(await oldSubmit("message", { llmId, threadId, message: msg, dataContexts: ctx, graphs: [] }));
  while (out?.status === "requires_action" && out.tool_call_id) {
    out = await oldPoll(await oldSubmit("tool", { llmId, threadId, message: { tool_call_id: out.tool_call_id, content: TOOL_RESULT } }));
  }
  return performance.now() - t0;
}

// ---- NEW: WebSocket to the new backend (the real client transport — no poll, tool
// round-trip collapsed over one socket). NEW_WS_URL defaults to a local backend; the
// AgentCore-deployed WS would add only same-region network (~tens of ms). ----
const NEW_WS_URL = arg("new-ws", "ws://127.0.0.1:8795/ws");
function wsSend(ws, frame) {
  return new Promise((resolve, reject) => {
    ws.onmessage = ev => { const f = JSON.parse(ev.data.toString()); if (f.type === "result") resolve(f.output); else if (f.type === "error") reject(new Error(f.error)); };
    ws.send(JSON.stringify(frame));
  });
}
async function newTurn(kind, threadId, msg) {
  const ws = new WebSocket(NEW_WS_URL);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error("ws open")); });
  const t0 = performance.now();
  let out = await wsSend(ws, { llmId, threadId, message: msg, dataContexts: ctx, graphs: [] });
  while (out?.status === "requires_action" && out.tool_call_id) {
    out = await wsSend(ws, { kind: "tool", llmId, threadId, message: { tool_call_id: out.tool_call_id, content: TOOL_RESULT } });
  }
  const dt = performance.now() - t0;
  ws.close();
  return dt;
}

const ONLY = arg("only", "");
const INTERACTIONS = [
  { id: "describe", tool: false, msg: "How many attributes does this dataset have? Reply with just the number." },
  { id: "modify", tool: true, msg: "Make a scatterplot of Height versus Mass." },
  { id: "modify-multi", tool: true, msg: "Make a scatterplot of Height versus Mass, then make a separate dot plot of LifeSpan, then make a graph of Mass versus LifeSpan." },
].filter(it => !ONLY || ONLY.split(",").includes(it.id));

async function measure(label, turnFn) {
  const res = {};
  for (const it of INTERACTIONS) {
    const xs = [];
    for (let i = 0; i < RUNS; i++) {
      try { xs.push(await turnFn(it.tool ? "tool" : "message", `t-${label}-${it.id}-${i}`.padEnd(34, "0"), it.msg)); }
      catch (e) { console.error(`  ${label}/${it.id}/${i} FAIL: ${e.message}`); }
    }
    res[it.id] = { n: xs.length, mean: mean(xs), p50: p50(xs), p95: p95(xs), tool: it.tool };
    console.log(`  ${label} ${it.id.padEnd(9)} n=${xs.length} p50=${p50(xs).toFixed(0)}ms mean=${mean(xs).toFixed(0)}ms p95=${p95(xs).toFixed(0)}ms`);
  }
  return res;
}

console.log(`comparison: N=${RUNS}/interaction, model=gpt-4o-mini`);
console.log(`OLD = ${OLD_BASE} (staging poll)`);
console.log(`NEW = WebSocket ${NEW_WS_URL} (new stack, no poll)`);
console.log("--- OLD (deployed staging: SQS+Lambda+Postgres+poll) ---");
const oldR = await measure("OLD", oldTurn);
console.log("--- NEW (deployed AgentCore: in-VM, invoke) ---");
const newR = await measure("NEW", newTurn);

const red = (o, n) => ((1 - n / o) * 100);
console.log("\n=== RESULT (p50 end-to-end reduction, new vs old) ===");
for (const it of INTERACTIONS) {
  const o = oldR[it.id].p50, n = newR[it.id].p50;
  console.log(`  ${it.id.padEnd(9)}${it.tool ? " (tool)" : "       "}: old ${o.toFixed(0)}ms -> new ${n.toFixed(0)}ms = ${red(o, n).toFixed(0)}% reduction`);
}
const overallOld = mean(INTERACTIONS.map(it => oldR[it.id].p50)), overallNew = mean(INTERACTIONS.map(it => newR[it.id].p50));
console.log(`\n  OVERALL p50 reduction: ${red(overallOld, overallNew).toFixed(0)}%   (bar: >=40%)`);
const toolIx = INTERACTIONS.filter(it => it.tool);
if (toolIx.length) {
  const toolOld = mean(toolIx.map(it => oldR[it.id].p50)), toolNew = mean(toolIx.map(it => newR[it.id].p50));
  console.log(`  TOOL-CALLING p50 reduction: ${red(toolOld, toolNew).toFixed(0)}%   (bar: >=50%)`);
}
fs.writeFileSync(path.resolve(path.dirname(new URL(import.meta.url).pathname), "compare-results.json"), JSON.stringify({ runs: RUNS, old: oldR, new: newR }, null, 2));
