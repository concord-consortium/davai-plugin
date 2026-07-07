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

// DAVAI-126 matrix round 5 Task G1: a live 1.7B final arrived as pretty-printed JSON missing its
// closing brace, and the old strict-then-brace-slice extractJson threw (no "}" at all), falling
// back to kind: "invalid" — whose `raw` text was then surfaced as if it were the spoken response.
// A screen reader would speak "open brace, tool, final, comma..." — actively harmful for the
// blind-user audience this whole app serves. Any text that plainly ATTEMPTS a "final" envelope
// (has a "tool" field naming "final") must never leak its raw JSON syntax; recover the "response"
// string tolerantly instead, up to whatever point it was actually generated.
const FINAL_TOOL_ATTEMPT = /"tool"\s*:\s*"final"/;

// Appends closing braces one at a time, re-parsing after each, up to a small bound — recovers the
// common case (pretty-printed final missing exactly one "}") without risking a runaway loop on
// text that was never going to parse no matter how many braces are appended.
const MAX_BRACE_REPAIR_ATTEMPTS = 3;
const repairByClosingBraces = (raw: string): any | undefined => {
  for (let i = 1; i <= MAX_BRACE_REPAIR_ATTEMPTS; i++) {
    try {
      return JSON.parse(raw + "}".repeat(i));
    } catch {
      // try appending one more
    }
  }
  return undefined;
};

// JSON-string-aware: matches escaped characters (\\., i.e. \" \\ \n etc.) as a unit so an escaped
// quote inside the response text never looks like the string's closing quote. The closing quote
// is OPTIONAL (`"?`) to also match the unterminated case — generation truncated mid-string, so
// there never was a closing quote to find; everything captured is simply "as far as it got".
const RESPONSE_FIELD = /"response"\s*:\s*"((?:[^"\\]|\\.)*)"?/;

// Un-escapes standard JSON string escapes the regex capture preserved raw (JSON.parse never ran
// over this text, so \" \\ \n etc. are still literal two-character sequences). Also strips a
// trailing lone backslash — the unterminated-string case can cut generation off immediately after
// an escape character, before its second character ever arrived.
const unescapeJsonString = (s: string): string => {
  const trimmed = s.endsWith("\\") && !s.endsWith("\\\\") ? s.slice(0, -1) : s;
  return trimmed.replace(/\\(.)/g, (_match, ch) => {
    switch (ch) {
      case "n": return "\n";
      case "t": return "\t";
      case "r": return "\r";
      default: return ch; // \" \\ \/ and anything else: the escaped character itself
    }
  });
};

// Last-resort recovery for text that plainly attempted a "final" envelope but failed strict/brace-
// slice parsing: try brace-repair first (handles the evidenced missing-closing-brace case cleanly,
// including any escaped content, via a real JSON.parse), then fall back to the tolerant regex
// (handles mid-string truncation, which no amount of brace-appending can fix). Returns undefined
// — never throws — when nothing recoverable is found, so callers keep the existing fallback.
const recoverFinalResponse = (raw: string): string | undefined => {
  if (!FINAL_TOOL_ATTEMPT.test(raw)) return undefined;

  const repaired = repairByClosingBraces(raw);
  if (typeof repaired?.response === "string" && repaired.response.length) {
    return repaired.response;
  }

  const match = RESPONSE_FIELD.exec(raw);
  if (match) {
    const recovered = unescapeJsonString(match[1]).trim();
    if (recovered.length) return recovered;
  }
  return undefined;
};

export const parseEnvelope = (rawInput: string): ParsedEnvelope => {
  const raw = stripThink(rawInput);
  let obj: any;
  try {
    obj = extractJson(raw);
  } catch (err) {
    const recovered = recoverFinalResponse(raw);
    if (recovered !== undefined) return { kind: "final", response: recovered };
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
