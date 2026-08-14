// Transport smoke test for the AgentCore entrypoint. Exercises the real handlers
// end to end (submit -> background run -> poll -> cancel) without a live LLM key:
// the turn fails inside getLangApp, which is enough to prove the queue/store/poll
// path works. Run against a server started with ENVIRONMENT=local.
//
//   ENVIRONMENT=local DAVAI_API_SECRET=smoke PORT=8763 npm run start:agentcore
//   node scripts/agentcore-smoke.mjs

const BASE = process.env.SMOKE_URL || "http://localhost:8763";
const SECRET = process.env.DAVAI_API_SECRET || "smoke";

let failures = 0;
const check = (name, ok, detail) => {
  console.log(`${ok ? "ok  " : "FAIL"}  ${name}${detail ? `  ${detail}` : ""}`);
  if (!ok) failures++;
};

const invoke = (payload, auth = SECRET) =>
  fetch(`${BASE}/invocations`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: auth },
    body: JSON.stringify(payload),
  });

const ping = await fetch(`${BASE}/ping`);
check("GET /ping -> 200", ping.status === 200, JSON.stringify(await ping.json()));

const unauthorized = await invoke({ action: "message", llmId: "x", message: "hi", threadId: "t" }, "wrong");
check("bad auth -> 401", unauthorized.status === 401);

const badAction = await invoke({ action: "nope" });
check("unknown action -> 400", badAction.status === 400);

const missingFields = await invoke({ action: "message", message: "hi" });
check("missing required fields -> 400", missingFields.status === 400);

const notFound = await invoke({ action: "status", messageId: "does-not-exist" });
check("status of unknown job -> 404", notFound.status === 404);

// Submit a real job. Without provider keys the turn fails, so the job should reach
// a terminal "error" status via the poll path.
const submit = await invoke({
  action: "message",
  llmId: JSON.stringify({ id: "gpt-4o-mini", provider: "OpenAI" }),
  message: "hello",
  threadId: "smoke-thread",
});
const submitBody = await submit.json();
check("POST message -> 202 + messageId", submit.status === 202 && !!submitBody.messageId, JSON.stringify(submitBody));

const { messageId } = submitBody;
let final;
for (let i = 0; i < 40; i++) {
  const res = await invoke({ action: "status", messageId });
  final = await res.json();
  if (["completed", "error", "cancelled"].includes(final.status)) break;
  await new Promise((r) => setTimeout(r, 250));
}
check("job reaches a terminal status via poll", ["completed", "error"].includes(final?.status), JSON.stringify(final));

// Cancel path: submit, cancel, then confirm the poll reports cancelled.
const second = await (await invoke({
  action: "message",
  llmId: JSON.stringify({ id: "gpt-4o-mini", provider: "OpenAI" }),
  message: "hello again",
  threadId: "smoke-thread-2",
})).json();
const cancelled = await invoke({ action: "cancel", messageId: second.messageId });
check("POST cancel -> 200", cancelled.status === 200);
const afterCancel = await (await invoke({ action: "status", messageId: second.messageId })).json();
check("cancelled job reports cancelled", afterCancel.status === "cancelled", JSON.stringify(afterCancel));

console.log(failures === 0 ? "\nall checks passed" : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
