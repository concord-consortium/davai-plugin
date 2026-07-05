import { localLlmInstructions } from "../../text/local-llm-instructions";
import { localCodapApiDoc } from "../../text/codap-api-documentation";
import { DAVAI_SPEAKER, USER_SPEAKER } from "../../constants";
import { IChatMsg } from "./local-llm-service";

// 8192-token window minus ~1K reserved for the model's reply, at ~4 chars/token.
export const DEFAULT_PROMPT_BUDGET_CHARS = (8192 - 1024) * 4;
const MAX_TRANSCRIPT_TURNS = 6;

// Mirrors the server prompt template in sam-server/src/utils/llm-utils.ts (instructions +
// API documentation + current data contexts + current graphs). `/no_think` is Qwen3's
// prompt-level switch to disable thinking mode.
export const buildLocalSystemPrompt = (dataContexts: unknown, graphs: unknown): string =>
  `${localLlmInstructions}

### CODAP API documentation:
${localCodapApiDoc}

### Current CODAP Data Contexts:
${JSON.stringify(dataContexts ?? {}, null, 2)}

### Current CODAP Graphs:
${JSON.stringify(graphs ?? [], null, 2)}

/no_think`;

export const buildTranscriptTurns = (
  messages: readonly { speaker: string; messageContent: { content: string } }[]
): IChatMsg[] =>
  messages
    .filter((m) => m.speaker === USER_SPEAKER || m.speaker === DAVAI_SPEAKER)
    .slice(-MAX_TRANSCRIPT_TURNS)
    .map((m) => ({
      role: m.speaker === USER_SPEAKER ? "user" as const : "assistant" as const,
      content: m.messageContent.content,
    }));

// Budget guard: drop oldest transcript turns first; as a last resort truncate the system
// prompt with an explicit marker (mirrors the server's MAX_TOKENS trim philosophy).
export const trimToBudget = (messages: IChatMsg[], maxChars = DEFAULT_PROMPT_BUDGET_CHARS): IChatMsg[] => {
  const total = (msgs: IChatMsg[]) => msgs.reduce((n, m) => n + m.content.length, 0);
  const out = [...messages];
  // out[0] is the system prompt; out[out.length - 1] is the current user message. Stop
  // dropping once only one transcript turn remains (length 3: system, turn, user) — the
  // most recent turn is preserved for continuity, and any further overage is handled by
  // truncating the system prompt below instead of removing the last bit of conversation.
  while (total(out) > maxChars && out.length > 3) {
    out.splice(1, 1); // drop the oldest transcript turn
  }
  if (total(out) > maxChars) {
    const sys = out[0];
    const others = total(out.slice(1));
    const room = Math.max(0, maxChars - others - 24);
    out[0] = { ...sys, content: `${sys.content.slice(0, room)}\n[context truncated]` };
  }
  return out;
};
