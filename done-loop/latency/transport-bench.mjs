// Pure-transport latency benchmark: LLM removed (both servers run DAVAI_FAKE_AGENT=1),
// so the measured time is ONLY the transport overhead the project changes — the poll
// discovery gap and, for a tool call, the SECOND queued job + its poll cycle.
//
// Usage: node transport-bench.mjs --ws-url ws://host/ws --poll-url http://host/ --runs 20
import net from "node:net"; // only for types; not required

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; };
const wsUrl = arg("ws-url", "ws://127.0.0.1:8961/ws");
const pollUrl = arg("poll-url", "http://127.0.0.1:8962/").replace(/\/$/, "");
const runs = parseInt(arg("runs", "20"), 10);
const llmId = JSON.stringify({ id: "gpt-4o-mini", provider: "OpenAI" });

const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const p50 = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];

// ---- WS driver ----
function wsSend(ws, frame) {
  return new Promise((resolve, reject) => {
    ws.onmessage = (ev) => {
      const f = JSON.parse(ev.data.toString());
      if (f.type === "result") resolve(f.output);
      else if (f.type === "error") reject(new Error(f.error));
    };
    ws.send(JSON.stringify(frame));
  });
}
async function wsScenario(threadId, tool) {
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error("open")); });
  const t0 = performance.now();
  let out = await wsSend(ws, { llmId, threadId, message: tool ? "tooltest" : "hi" });
  while (out?.status === "requires_action") out = await wsSend(ws, { kind: "tool", llmId, threadId, message: { tool_call_id: out.tool_call_id, content: "[]" } });
  const dt = performance.now() - t0;
  ws.close();
  return dt;
}

// ---- poll driver (old transport) ----
async function submit(endpoint, body) {
  const r = await fetch(`${pollUrl}/default/davaiServer/${endpoint}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return (await r.json()).messageId;
}
async function poll(id) {
  for (;;) {
    const r = await fetch(`${pollUrl}/default/davaiServer/status?messageId=${id}`);
    const { status, output } = await r.json();
    if (status === "completed") return output;
    if (status === "error") throw new Error("err");
    await new Promise((res) => setTimeout(res, status === "streaming" ? 500 : 1000));
  }
}
async function pollScenario(threadId, tool) {
  const t0 = performance.now();
  let out = await poll(await submit("message", { llmId, threadId, message: tool ? "tooltest" : "hi" }));
  while (out?.status === "requires_action") out = await poll(await submit("tool", { llmId, threadId, message: { tool_call_id: out.tool_call_id, content: "[]" } }));
  return performance.now() - t0;
}

async function bench(name, fn, tool) {
  const xs = [];
  for (let i = 0; i < runs; i++) xs.push(await fn(`t-bench-${name}-${tool ? "tool" : "plain"}-${i}`.padEnd(36, "0"), tool));
  return { mean: mean(xs), p50: p50(xs) };
}

console.log(`transport bench (LLM removed): runs=${runs}`);
for (const [label, tool] of [["plain turn", false], ["tool round-trip", true]]) {
  const ws = await bench("ws", wsScenario, tool);
  const pl = await bench("poll", pollScenario, tool);
  const red = (1 - ws.p50 / pl.p50) * 100;
  console.log(`\n${label}:`);
  console.log(`  WS   p50=${ws.p50.toFixed(0)}ms mean=${ws.mean.toFixed(0)}ms`);
  console.log(`  POLL p50=${pl.p50.toFixed(0)}ms mean=${pl.mean.toFixed(0)}ms`);
  console.log(`  => WS reduces p50 transport overhead by ${red.toFixed(0)}% (${(pl.p50 - ws.p50).toFixed(0)}ms saved)`);
}
