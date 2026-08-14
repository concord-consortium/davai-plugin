// WS transport smoke test (run against a server started with DAVAI_FAKE_AGENT=1).
// Verifies: token streaming, a plain turn result, and the mid-turn tool round-trip
// (requires_action -> client sends tool result on the SAME socket -> final response).
import WebSocket from "ws";

const PORT = process.env.WS_PORT || 8770;
const url = `ws://127.0.0.1:${PORT}/ws`;
const threadId = "t-ws-smoke-0000000000000000000000000000000"; // >= 33 chars
const llmId = JSON.stringify({ id: "gpt-4o", provider: "OpenAI" });

function run() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    let phase = "plain";
    let sawTokenPlain = false;
    let sawTokenTool = false;
    let toolCallId = null;
    const fail = (m) => { try { ws.close(); } catch {} reject(new Error(m)); };

    ws.on("open", () => ws.send(JSON.stringify({ llmId, threadId, message: "hi" })));
    ws.on("error", (e) => fail("ws error: " + e.message));
    const timer = setTimeout(() => fail("timeout"), 8000);

    ws.on("message", (raw) => {
      const f = JSON.parse(raw.toString());
      if (f.type === "token") {
        if (phase === "plain") sawTokenPlain = true;
        else if (phase === "toolstart") sawTokenTool = true;
        return;
      }
      if (f.type === "error") return fail("error frame: " + f.error);
      if (f.type === "seeded") {
        if (phase !== "seed") return fail("unexpected seeded in phase " + phase);
        if (f.count !== 2) return fail("seed count wrong: " + f.count);
        clearTimeout(timer);
        ws.close();
        return resolve({ sawTokenPlain, sawTokenTool, toolCallId, seeded: f.count });
      }
      if (f.type !== "result") return;

      if (phase === "plain") {
        if (f.output?.response !== "Hello, world.")
          return fail("plain result wrong: " + JSON.stringify(f.output));
        phase = "toolstart";
        ws.send(JSON.stringify({ llmId, threadId, message: "tooltest" }));
      } else if (phase === "toolstart") {
        if (f.output?.status !== "requires_action")
          return fail("expected requires_action, got " + JSON.stringify(f.output));
        toolCallId = f.output.tool_call_id;
        phase = "toolresult";
        // Client executed the CODAP op; return the result over the SAME socket.
        ws.send(JSON.stringify({ kind: "tool", llmId, threadId, message: { tool_call_id: toolCallId, content: "[]" } }));
      } else if (phase === "toolresult") {
        if (!/tool result: \[\]/.test(f.output?.response || ""))
          return fail("tool final wrong: " + JSON.stringify(f.output));
        // Idle re-seed: inject a transcript into the thread (server updateState, no LLM).
        phase = "seed";
        ws.send(JSON.stringify({
          type: "seed",
          threadId,
          llmId,
          messages: [
            { role: "user", content: "a" },
            { role: "assistant", content: "b" },
          ],
        }));
      }
    });
  });
}

run()
  .then((r) => {
    if (!r.sawTokenPlain || !r.sawTokenTool) {
      console.error("FAIL: missing token frames", r);
      process.exit(1);
    }
    if (r.seeded !== 2) {
      console.error("FAIL: seed not confirmed", r);
      process.exit(1);
    }
    console.log("WS smoke PASS: streaming + tool round-trip + idle re-seed over one socket", r);
    process.exit(0);
  })
  .catch((e) => {
    console.error("WS smoke FAIL:", e.message);
    process.exit(1);
  });
