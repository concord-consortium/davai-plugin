import { IChatMsg } from "./local-llm-service";
import { parseEnvelope, stripThink } from "./local-llm-envelope";
import { trimToBudget } from "./local-llm-prompt";
import { IToolCallData } from "../../types";

export interface ILocalTurnArgs {
  generate: (messages: IChatMsg[]) => Promise<string>;
  executeTool: (data: IToolCallData) => Promise<string>;
  systemPrompt: string;
  turns: IChatMsg[];
  userMessage: string;
  maxRounds?: number;
}

const FALLBACK_RESPONSE =
  "Sorry, I wasn't able to complete that request with the local model. Please try rephrasing, or switch to a server model.";

export const runLocalTurn = async (args: ILocalTurnArgs): Promise<string> => {
  const { generate, executeTool, systemPrompt, turns, userMessage, maxRounds = 5 } = args;
  const messages: IChatMsg[] = trimToBudget([
    { role: "system", content: systemPrompt },
    ...turns,
    { role: "user", content: userMessage },
  ]);

  let toolRounds = 0;
  let invalidRetried = false;

  // Each iteration is one generation. Tool rounds and one invalid-envelope retry both
  // continue the loop; anything else returns.
  for (let generation = 0; generation < maxRounds * 2 + 2; generation++) {
    const raw = await generate(messages);
    const envelope = parseEnvelope(raw, toolRounds);

    if (envelope.kind === "final") return envelope.response;

    if (envelope.kind === "invalid") {
      const text = stripThink(raw);
      if (invalidRetried || !text) {
        return text || FALLBACK_RESPONSE;
      }
      invalidRetried = true;
      messages.push({ role: "assistant", content: raw });
      messages.push({
        role: "user",
        content: `Your response was not valid: ${envelope.error} Respond with a single JSON object only, using one of the three allowed forms.`,
      });
      continue;
    }

    // tool_call
    toolRounds++;
    messages.push({ role: "assistant", content: raw });
    if (toolRounds > maxRounds) {
      messages.push({
        role: "user",
        content: "You have used all of your tool requests. You must answer now: respond with {\"tool\": \"final\", \"response\": \"...\"} using what you already know.",
      });
      const lastRaw = await generate(messages);
      const lastEnvelope = parseEnvelope(lastRaw, toolRounds);
      if (lastEnvelope.kind === "final") return lastEnvelope.response;
      return stripThink(lastRaw) || FALLBACK_RESPONSE;
    }
    const result = await executeTool(envelope.data);
    messages.push({ role: "user", content: `Tool result: ${result}` });
  }
  return FALLBACK_RESPONSE;
};
