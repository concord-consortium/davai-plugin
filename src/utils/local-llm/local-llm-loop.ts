import { IChatMsg } from "./local-llm-service";
import { parseEnvelope, stripThink } from "./local-llm-envelope";
import { trimToBudget } from "./local-llm-prompt";

export interface ILocalTurnArgs {
  generate: (messages: IChatMsg[]) => Promise<string>;
  executeTool: (name: string, args: Record<string, unknown>) => Promise<string>;
  systemPrompt: string;
  turns: IChatMsg[];
  userMessage: string;
  maxRounds?: number;
  // C1: polled between generations (and before the first one). When it returns true the turn
  // has been cancelled/superseded, so the loop stops early and returns the fallback WITHOUT
  // running another generation. The caller is responsible for discarding this stale result.
  isCancelled?: () => boolean;
  // Optional instrumentation hook: invoked with the tool's name immediately before executeTool
  // runs for that round. Used by the eval harness (DAVAI-126) to record the tool-call sequence
  // for a turn without changing the loop's own control flow.
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

// Identifies a tool call by name + arguments so an identical repeat can be recognized regardless
// of key order sensitivity concerns: args come from parseEnvelope's own JSON.parse of the model's
// output, so two calls with the same semantic args produce the same object shape/key order here.
const callKey = (name: string, args: Record<string, unknown>): string => `${name}::${JSON.stringify(args)}`;

const FORCED_FINAL_PROMPT =
  "You have used all of your tool requests. You must answer now: respond with {\"tool\": \"final\", \"response\": \"...\"} using what you already know.";

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
      const text = stripThink(raw);
      if (invalidRetried || !text) {
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
      const lastEnvelope = parseEnvelope(lastRaw);
      if (lastEnvelope.kind === "final") return lastEnvelope.response;
      return stripThink(lastRaw) || FALLBACK_RESPONSE;
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
      const lastEnvelope = parseEnvelope(lastRaw);
      if (lastEnvelope.kind === "final") return lastEnvelope.response;
      return stripThink(lastRaw) || FALLBACK_RESPONSE;
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
