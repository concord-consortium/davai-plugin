// The runtime is invocable by unauthenticated (Cognito) identities, so treat every
// field as attacker-controlled. Providers are allowlisted and model ids are shape-
// checked (an exact model allowlist would drift as app-config.json evolves; the
// provider gate is what prevents routing to arbitrary integrations).
const ALLOWED_PROVIDERS = new Set(["OpenAI", "Anthropic", "Google"]);
const MODEL_ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;
// Union of effortLevels across src/app-config.json's llmList.
const ALLOWED_EFFORT = new Set(["", "none", "minimal", "low", "medium", "high", "xhigh", "max", "think"]);

export function validateLlmId(llmId: string): string | null {
  let parsed: any;
  try {
    parsed = JSON.parse(llmId);
  } catch {
    return "llmId must be a JSON string";
  }
  if (!parsed || typeof parsed !== "object") return "llmId must encode an object";
  if (!ALLOWED_PROVIDERS.has(parsed.provider)) return "unsupported provider";
  if (typeof parsed.id !== "string" || !MODEL_ID_PATTERN.test(parsed.id)) return "unsupported model id";
  return null;
}

// Shared turn-input validation for both /invocations and /ws.
export function validateTurn(body: any): string | null {
  if (!body || typeof body !== "object") return "body must be a JSON object";
  if (typeof body.llmId !== "string") return "llmId (string) is required";
  const llmError = validateLlmId(body.llmId);
  if (llmError) return llmError;
  if (body.effort !== undefined && !(typeof body.effort === "string" && ALLOWED_EFFORT.has(body.effort))) {
    return "unsupported effort";
  }
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
