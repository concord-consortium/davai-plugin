// Measures the DEPLOYED new stack's per-turn latency via the AgentCore invoke API
// (aws bedrock-agentcore invoke-agent-runtime). This is the new-stack side of the
// metric-#2 comparison, from the real deployed environment. Needs aws creds on PATH.
//
// Usage: node agentcore-bench.mjs --arn <runtime-arn> --runs 8
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const ex = promisify(execFile);

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; };
const ARN = arg("arn", "arn:aws:bedrock-agentcore:us-east-1:816253370536:runtime/davai_agentcore-0c9quSDd49");
const RUNS = parseInt(arg("runs", "8"), 10);
const REGION = arg("region", "us-east-1");
const llmId = JSON.stringify({ id: "gpt-4o-mini", provider: "OpenAI" });
const ctx = [{ name: "Mammals", collections: [{ name: "Cases", attrs: [{ name: "Height" }, { name: "Mass" }] }] }];
const tmp = path.join(os.tmpdir(), "ac-bench");
fs.mkdirSync(tmp, { recursive: true });

async function invoke(session, payloadObj) {
  const pf = path.join(tmp, `p-${Math.floor(performance.now())}-${Math.random().toString(36).slice(2)}.json`);
  const of = pf + ".out";
  fs.writeFileSync(pf, JSON.stringify(payloadObj));
  await ex("aws", ["bedrock-agentcore", "invoke-agent-runtime", "--region", REGION,
    "--agent-runtime-arn", ARN, "--runtime-session-id", session,
    "--content-type", "application/json", "--payload", `fileb://${pf}`, of], { maxBuffer: 10 * 1024 * 1024 });
  const out = JSON.parse(fs.readFileSync(of, "utf8"));
  fs.rmSync(pf); fs.rmSync(of);
  return out;
}

const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const p50 = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];

async function timePlain(i) {
  const s = `sess-plain-${i}`.padEnd(36, "0");
  const t0 = performance.now();
  await invoke(s, { llmId, threadId: `t-plain-${i}`.padEnd(36, "0"), message: "Reply with exactly: pong" });
  return performance.now() - t0;
}
async function timeTool(i) {
  const s = `sess-tool-${i}`.padEnd(36, "0"), th = `t-tool-${i}`.padEnd(36, "0");
  const t0 = performance.now();
  let out = await invoke(s, { llmId, threadId: th, message: "Make a scatterplot of Height versus Mass.", dataContexts: ctx, graphs: [] });
  while (out?.status === "requires_action") out = await invoke(s, { kind: "tool", llmId, threadId: th, message: { tool_call_id: out.tool_call_id, content: "Graph created." } });
  return performance.now() - t0;
}

console.log(`deployed AgentCore latency: runs=${RUNS} arn=…${ARN.slice(-24)}`);
for (const [label, fn] of [["plain turn", timePlain], ["tool round-trip", timeTool]]) {
  const xs = [];
  for (let i = 0; i < RUNS; i++) xs.push(await fn(i));
  console.log(`  ${label.padEnd(16)} n=${xs.length} mean=${mean(xs).toFixed(0)}ms p50=${p50(xs).toFixed(0)}ms min=${Math.min(...xs).toFixed(0)} max=${Math.max(...xs).toFixed(0)}`);
}
