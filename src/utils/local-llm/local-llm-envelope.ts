export type ParsedEnvelope =
  | { kind: "tool_call"; name: string; args: Record<string, unknown>; raw: string }
  | { kind: "final"; response: string }
  | { kind: "invalid"; raw: string; error: string };

// Qwen3 emits <think>…</think> when thinking mode leaks through; json_object grammar
// should prevent it, but strip defensively so a leak degrades instead of failing.
//
// DAVAI-126 matrix round 3 item E7: also strips a trailing UNCLOSED <think> block — evidence:
// both think-mode matrix runs' selection-percentile finals were raw <think> dumps truncated
// mid-sentence at maxTokens (generation truncation always cuts at the END of the raw output, so
// an unclosed block is always the trailing one). The first pass removes every CLOSED pair; any
// "<think>" surviving that pass is therefore unclosed, and the second pass strips it to end of
// string — leaving whatever valid text preceded it (e.g. a JSON envelope) intact.
export const stripThink = (raw: string): string =>
  raw.replace(/<think>[\s\S]*?<\/think>/g, "").replace(/<think>[\s\S]*$/, "").trim();

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
