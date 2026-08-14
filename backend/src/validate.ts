// Shared turn-input validation for both /invocations and /ws.
export function validateTurn(body: any): string | null {
  if (!body || typeof body !== "object") return "body must be a JSON object";
  if (typeof body.llmId !== "string") return "llmId (string) is required";
  if (typeof body.threadId !== "string") return "threadId (string) is required";
  if (body.kind === "tool") {
    if (!body.message || typeof body.message.tool_call_id !== "string") {
      return "tool turn requires message.tool_call_id";
    }
  } else if (typeof body.message !== "string") {
    return "message (string) is required";
  }
  return null;
}
