// LIVE WS end-to-end check against the real agent (needs OPENAI_API_KEY in the env).
// Proves the /ws transport with a real LLM: streaming, a plain turn, and a full
// tool round-trip (requires_action -> tool result over the same socket -> response).
import WebSocket from "ws";

const PORT = process.env.WS_PORT || 8770;
const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
const threadId = "t-wslive-00000000000000000000000000000000";
const llmId = JSON.stringify({ id: "gpt-4o-mini", provider: "OpenAI" });
const ctx = [{ name: "Mammals", collections: [{ name: "Cases", attrs: [{ name: "Height" }, { name: "Mass" }] }] }];

let phase = "plain";
let tokens = 0;
let toolCallId = null;
const fail = (m) => { console.error("WS-LIVE FAIL:", m); try { ws.close(); } catch {} process.exit(1); };
const t = setTimeout(() => fail("timeout"), 40000);

ws.on("open", () => ws.send(JSON.stringify({ llmId, threadId, message: "Reply with exactly: pong" })));
ws.on("error", (e) => fail("ws error " + e.message));
ws.on("message", (raw) => {
  const f = JSON.parse(raw.toString());
  if (f.type === "token") { tokens++; return; }
  if (f.type === "error") return fail("error frame: " + f.error);
  if (f.type !== "result") return;

  if (phase === "plain") {
    if (!/pong/i.test(f.output?.response || "")) return fail("plain turn wrong: " + JSON.stringify(f.output));
    console.log("  plain turn OK:", JSON.stringify(f.output.response));
    phase = "tool";
    ws.send(JSON.stringify({ llmId, threadId, message: "Make a scatterplot of Height versus Mass.", dataContexts: ctx, graphs: [] }));
  } else if (phase === "tool") {
    if (f.output?.status !== "requires_action") return fail("expected requires_action, got " + JSON.stringify(f.output));
    toolCallId = f.output.tool_call_id;
    console.log("  tool call OK:", f.output.request?.values?.type, "->", JSON.stringify(f.output.request?.values?.dataContext));
    phase = "toolresult";
    // Simulate the client executing CODAP and returning the result over the same socket.
    ws.send(JSON.stringify({ kind: "tool", llmId, threadId, message: { tool_call_id: toolCallId, content: "Graph created successfully." } }));
  } else if (phase === "toolresult") {
    if (typeof f.output?.response !== "string" || !f.output.response.length)
      return fail("tool final wrong: " + JSON.stringify(f.output));
    console.log("  tool round-trip OK, final:", JSON.stringify(f.output.response.slice(0, 80)));
    clearTimeout(t);
    ws.close();
    console.log(`WS-LIVE PASS (tokens streamed: ${tokens})`);
    process.exit(0);
  }
});
