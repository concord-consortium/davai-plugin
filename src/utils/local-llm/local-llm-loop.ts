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

export const runLocalTurn = async (args: ILocalTurnArgs): Promise<string> => {
  const { generate, executeTool, systemPrompt, turns, userMessage, maxRounds = 5, isCancelled } = args;

  // The conversation after the system prompt: the prior transcript turns, the current user
  // message, and everything the loop appends (assistant envelopes, tool results, corrective
  // prompts). Re-trimmed against the budget before every generation.
  const conversation: IChatMsg[] = [...turns, { role: "user", content: userMessage }];
  const budgeted = () => trimToBudget([{ role: "system", content: systemPrompt }, ...conversation]);

  let toolRounds = 0;
  let invalidRetried = false;

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
      conversation.push({ role: "assistant", content: raw });
      conversation.push({
        role: "user",
        content: `Your response was not valid: ${envelope.error} Respond with a single JSON object only, using one of the allowed forms.`,
      });
      continue;
    }

    // tool_call
    toolRounds++;
    conversation.push({ role: "assistant", content: raw });
    if (toolRounds > maxRounds) {
      conversation.push({
        role: "user",
        content: "You have used all of your tool requests. You must answer now: respond with {\"tool\": \"final\", \"response\": \"...\"} using what you already know.",
      });
      if (isCancelled?.()) return FALLBACK_RESPONSE;
      const lastRaw = await generate(budgeted());
      const lastEnvelope = parseEnvelope(lastRaw);
      if (lastEnvelope.kind === "final") return lastEnvelope.response;
      return stripThink(lastRaw) || FALLBACK_RESPONSE;
    }
    const result = await executeTool(envelope.name, envelope.args);
    conversation.push({ role: "user", content: `Tool result: ${capToolResult(result)}` });
  }
  return FALLBACK_RESPONSE;
};
