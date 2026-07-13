export type ParsedEnvelope =
  | { kind: "tool_call"; name: string; args: Record<string, unknown>; raw: string }
  | { kind: "final"; response: string }
  | { kind: "invalid"; raw: string; error: string };

// Qwen3 emits <think>…</think> when thinking mode leaks through; json_object grammar
// should prevent it, but strip defensively so a leak degrades instead of failing.
//
// Also strips a trailing unclosed <think> block: generation truncation always cuts at the end of
// raw output, so any "<think>" surviving the closed-pair pass is unclosed; strip it to end of
// string, leaving preceding valid text intact (e.g. a JSON envelope).
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

// A JSON object that's missing its closing brace (e.g. a pretty-printed final cut short) fails
// both strict JSON.parse and the brace-slice fallback, landing on kind: "invalid" — whose `raw`
// text would then be surfaced as if it were the spoken response. A screen reader would speak
// "open brace, tool, final, comma..." — actively harmful for the blind-user audience this whole
// app serves. Any text that plainly ATTEMPTS a "final" envelope (has a "tool" field naming
// "final") must never leak its raw JSON syntax; recover the "response" string tolerantly instead,
// up to whatever point it was actually generated.
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
  // Prefer a real JSON.parse of the reconstructed string literal: it decodes EVERY standard JSON
  // escape correctly — including \uXXXX, \b and \f — which a hand-rolled single-character switch
  // cannot (a naive switch turns "é" into the literal "u00e9", garbling accented/CJK text
  // that a truncated international description may contain). The RESPONSE_FIELD capture never holds
  // an unescaped '"', so the only ways this throws are a raw control character or a stray escape
  // the tolerant regex admitted — both handled by the best-effort manual fallback below.
  try {
    return JSON.parse(`"${trimmed}"`);
  } catch {
    return trimmed.replace(/\\(u[0-9a-fA-F]{4}|.)/g, (_match, esc: string) => {
      // Only a FULL 5-char capture ("u" + 4 hex digits, matched via the regex's FIRST
      // alternative) is a real \uXXXX escape — parseInt on it can never be NaN. A malformed or
      // truncated \u (generation cut off right after "\u", or followed by non-hex characters)
      // falls through to the regex's SECOND alternative instead, which captures just the bare
      // "u" character (length 1) — treating that as a unicode escape would feed
      // parseInt("", 16) = NaN, and String.fromCharCode(NaN) would silently insert a NUL
      // character into the "recovered" text. Fall through to the same literal-passthrough the
      // switch's default case already gives any other unrecognized escape.
      if (esc.length === 5 && esc[0] === "u") return String.fromCharCode(parseInt(esc.slice(1), 16));
      switch (esc) {
        case "n": return "\n";
        case "t": return "\t";
        case "r": return "\r";
        case "b": return "\b";
        case "f": return "\f";
        default: return esc; // \" \\ \/ and anything else: the escaped character itself
      }
    });
  }
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
