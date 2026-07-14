import { IChatMsg } from "./local-llm-service";
import { ParsedEnvelope, parseEnvelope, stripThink } from "./local-llm-envelope";
import { trimToBudget } from "./local-llm-prompt";

export interface ILocalTurnArgs {
  generate: (messages: IChatMsg[]) => Promise<string>;
  executeTool: (name: string, args: Record<string, unknown>) => Promise<string>;
  systemPrompt: string;
  turns: IChatMsg[];
  userMessage: string;
  maxRounds?: number;
  // Polled between generations (and before the first one). When it returns true the turn
  // has been cancelled/superseded, so the loop stops early and returns the fallback WITHOUT
  // running another generation. The caller is responsible for discarding this stale result.
  isCancelled?: () => boolean;
  // Optional instrumentation hook: invoked with the tool's name immediately before executeTool
  // runs for that round. Used by the eval harness to record the tool-call sequence for a turn
  // without changing the loop's own control flow.
  onToolCall?: (name: string) => void;
}

const FALLBACK_RESPONSE =
  "Sorry, I wasn't able to complete that request with the local model. Please try rephrasing, or switch to a server model.";

// A single tool result (CODAP JSON) can be 5–30 KB; cap it so one oversized result can't blow
// the prompt budget on the next round even when round 1 fit comfortably.
export const MAX_TOOL_RESULT_CHARS = 8000;
const TOOL_RESULT_TRUNCATED_MARKER = "[tool result truncated]";

const capToolResult = (result: string): string =>
  result.length <= MAX_TOOL_RESULT_CHARS
    ? result
    : `${result.slice(0, MAX_TOOL_RESULT_CHARS)}\n${TOOL_RESULT_TRUNCATED_MARKER}`;

// A JSON.stringify replacer that sorts object keys at every level so semantically-identical args
// produce the same string regardless of the order the model happened to emit them in on a retry —
// a plain JSON.stringify(args) is key-order-sensitive, so a repeat with reordered keys could slip
// past the repeat-call guard below and let a mutating tool double-execute.
const sortKeysReplacer = (_key: string, value: unknown): unknown => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return value;
  return Object.keys(value as Record<string, unknown>).sort().reduce((sorted, k) => {
    sorted[k] = (value as Record<string, unknown>)[k];
    return sorted;
  }, {} as Record<string, unknown>);
};

// Identifies a tool call by name + arguments so an identical repeat can be recognized regardless
// of the key order the model's raw JSON happened to use.
const callKey = (name: string, args: Record<string, unknown>): string =>
  `${name}::${JSON.stringify(args, sortKeysReplacer)}`;

const FORCED_FINAL_PROMPT =
  "You have used all of your tool requests. You must answer now: respond with {\"tool\": \"final\", \"response\": \"...\"} using what you already know.";

// A forced-final reply wrapped in a markdown code fence (e.g.
// "```json\n{\"tool\": \"get_stats\"...", closed or not) still ATTEMPTS JSON — the leading
// backtick just hides that from the plain `startsWith("{")` check below. Strips a leading/
// wrapping fence so the speakability test judges the actual content, not its markdown wrapper.
// Only strips a fence anchored at the very start of the (already think-stripped) text; a fence
// appearing mid-text is left alone. When the text isn't closed, the trailing-fence removal simply
// finds no match and leaves everything after the opening fence line intact.
const CODE_FENCE_OPEN = /^```[^\n]*\n/;
const CODE_FENCE_CLOSE = /\n?```\s*$/;
const stripWrappingCodeFence = (text: string): string =>
  CODE_FENCE_OPEN.test(text) ? text.replace(CODE_FENCE_OPEN, "").replace(CODE_FENCE_CLOSE, "") : text;

// Matches at the START (a de-fenced JSON attempt) or ANYWHERE (a `"tool": ...` field surviving
// inside otherwise-unparseable text) — either shape means the model was still trying to produce
// JSON, never a real prose answer to the nudge.
const UNSPEAKABLE_JSON_SHAPE = /^\{|"tool"\s*:/;

// Shared tail for both forced-final generations (the round-cap path and the 2nd-consecutive-
// identical-repeat path) — the "answer now" nudge only ASKS for {"tool":"final",...}; nothing
// stops the model from answering with another tool call, or with still-malformed text. A
// well-formed final always wins outright (including parseEnvelope's own tolerant recovery of a
// malformed-but-recognizable "final" attempt — that already arrives here as kind: "final", so it
// is unaffected by anything below). A well-formed TOOL CALL must never be spoken raw (the user
// would hear "{tool: get_stats, ...}" read aloud) — degrade straight to FALLBACK_RESPONSE.
// Anything else (kind: "invalid") gets ONE more chance, judged AFTER stripping a wrapping code
// fence: if what's left plainly looks like ANOTHER JSON attempt (starts with "{", or still
// contains a `"tool":` field), that is still unspeakable syntax, so fall back too; otherwise it is
// ordinary prose — a real, if informal, answer to the nudge — and is safe to speak as-is, fence
// stripped.
const resolveForcedFinal = (raw: string, envelope: ParsedEnvelope): string => {
  if (envelope.kind === "final") return envelope.response;
  if (envelope.kind === "tool_call") return FALLBACK_RESPONSE;
  const text = stripThink(raw);
  const defenced = stripWrappingCodeFence(text).trim();
  if (UNSPEAKABLE_JSON_SHAPE.test(defenced)) return FALLBACK_RESPONSE;
  return defenced || FALLBACK_RESPONSE;
};

export const runLocalTurn = async (args: ILocalTurnArgs): Promise<string> => {
  const { generate, executeTool, systemPrompt, turns, userMessage, maxRounds = 5, isCancelled, onToolCall } = args;

  // The conversation after the system prompt: the prior transcript turns, the current user
  // message, and everything the loop appends (assistant envelopes, tool results, corrective
  // prompts). Re-trimmed against the budget before every generation.
  const conversation: IChatMsg[] = [...turns, { role: "user", content: userMessage }];
  const budgeted = () => trimToBudget([{ role: "system", content: systemPrompt }, ...conversation]);

  let toolRounds = 0;
  let invalidRetried = false;
  // The most recently EXECUTED call (never set for an intercepted repeat), and how many
  // consecutive times since then the model has repeated that exact call without it re-executing.
  // A fresh call (different name or args) resets `repeatCount` to 0 without touching `lastCall`
  // until the new call itself executes.
  let lastCall: { key: string; result: string } | null = null;
  let repeatCount = 0;

  // Each iteration is one generation. Tool rounds and one invalid-envelope retry both
  // continue the loop; anything else returns.
  for (let generation = 0; generation < maxRounds * 2 + 2; generation++) {
    if (isCancelled?.()) return FALLBACK_RESPONSE;
    const raw = await generate(budgeted());
    const envelope = parseEnvelope(raw);

    if (envelope.kind === "final") return envelope.response;

    if (envelope.kind === "invalid") {
      // `text` is empty whenever the raw generation was PURELY an unclosed <think> dump
      // (stripThink strips a trailing unclosed block too — see its own comment). The only thing
      // that should skip the retry is having ALREADY retried once (`invalidRetried`); an empty
      // `text` goes through the exact same retry-once path any other invalid envelope gets. If
      // the retry ALSO ends up empty/invalid, `text || FALLBACK_RESPONSE` below still degrades to
      // the safe fallback — never raw reasoning as the final.
      const text = stripThink(raw);
      if (invalidRetried) {
        return text || FALLBACK_RESPONSE;
      }
      invalidRetried = true;
      conversation.push({ role: "assistant", content: text });
      conversation.push({
        role: "user",
        content: `Your response was not valid: ${envelope.error} Respond with a single JSON object only, using one of the allowed forms.`,
      });
      continue;
    }

    // tool_call
    toolRounds++;
    // Push the think-stripped text, not raw: parsing already strips <think> tags when reading
    // THIS envelope, but the pushed history is what future generations see, and an unstripped
    // <think> block would otherwise bloat the conversation window every round once thinking is
    // enabled (harmless without it — stripThink is a no-op on text with no <think> tags). Follows
    // Qwen's own strip-history convention.
    conversation.push({ role: "assistant", content: stripThink(raw) });

    const key = callKey(envelope.name, envelope.args);
    const isRepeat = lastCall !== null && lastCall.key === key;
    repeatCount = isRepeat ? repeatCount + 1 : 0;

    // Second consecutive identical repeat: the model isn't responding to the nudge, so stop
    // burning rounds on it and force a final answer the same way the round cap does. This check
    // runs before the round-cap check below so a repeat landing exactly on the cap still gets
    // this branch's forced-final behavior rather than the cap's (equivalent, but this is the
    // path whose intent — "the model is stuck repeating" — actually applies).
    if (isRepeat && repeatCount >= 2) {
      conversation.push({ role: "user", content: FORCED_FINAL_PROMPT });
      if (isCancelled?.()) return FALLBACK_RESPONSE;
      const lastRaw = await generate(budgeted());
      return resolveForcedFinal(lastRaw, parseEnvelope(lastRaw));
    }

    // First repeat of an already-executed call: don't re-execute (this protects mutating tools
    // like create_graph/create_attribute/select_cases from double-firing) and don't fire
    // onToolCall (nothing executed). Nudge the model with the prior result instead of running
    // the tool again. lastCall.result is already capped (it was capped before being stored below).
    if (isRepeat && lastCall) {
      conversation.push({
        role: "user",
        content: `You already called ${envelope.name} with those arguments. Its result was: ` +
          `${lastCall.result} — do not call it again; answer the user now with ` +
          `{"tool": "final", ...}.`,
      });
      continue;
    }

    if (toolRounds > maxRounds) {
      conversation.push({ role: "user", content: FORCED_FINAL_PROMPT });
      if (isCancelled?.()) return FALLBACK_RESPONSE;
      const lastRaw = await generate(budgeted());
      return resolveForcedFinal(lastRaw, parseEnvelope(lastRaw));
    }
    // Recheck here (not just at the top of the loop): generate() above is an await, so a cancel
    // can land WHILE it's producing this tool envelope — after the iteration-top check already
    // passed. Without this recheck, that cancel would still let a tool with real side effects
    // (create_graph/create_attribute/select_cases) execute against CODAP.
    if (isCancelled?.()) return FALLBACK_RESPONSE;
    onToolCall?.(envelope.name);
    const result = await executeTool(envelope.name, envelope.args);
    const cappedResult = capToolResult(result);
    lastCall = { key, result: cappedResult };
    conversation.push({ role: "user", content: `Tool result: ${cappedResult}` });
  }
  return FALLBACK_RESPONSE;
};
