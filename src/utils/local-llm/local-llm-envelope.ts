export type ParsedEnvelope =
  | { kind: "tool_call"; name: string; args: Record<string, unknown>; raw: string }
  | { kind: "final"; response: string }
  | { kind: "invalid"; raw: string; error: string };

// Qwen3 emits <think>…</think> when thinking mode leaks through; json_object grammar
// should prevent it, but strip defensively so a leak degrades instead of failing.
export const stripThink = (raw: string): string =>
  raw.replace(/<think>[\s\S]*?<\/think>/g, "").trim();

const extractJson = (raw: string): any => {
  try {
    return JSON.parse(raw);
  } catch {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(raw.slice(start, end + 1));
    }
    throw new Error("no JSON object found");
  }
};

export const parseEnvelope = (rawInput: string): ParsedEnvelope => {
  const raw = stripThink(rawInput);
  let obj: any;
  try {
    obj = extractJson(raw);
  } catch (err) {
    return { kind: "invalid", raw, error: "Response was not a JSON object." };
  }

  if (typeof obj?.tool === "string" && obj.tool.length) {
    if (obj.tool === "final") {
      if (typeof obj.response !== "string" || !obj.response.length) {
        return { kind: "invalid", raw, error: "\"final\" requires a non-empty \"response\" string." };
      }
      return { kind: "final", response: obj.response };
    }
    const { tool, ...args } = obj;
    return { kind: "tool_call", name: tool, args, raw };
  }
  return { kind: "invalid", raw, error: "Respond with one JSON object containing a \"tool\" field." };
};
