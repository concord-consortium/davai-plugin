import { localLlmInstructions } from "../../text/local-llm-instructions";
import { DAVAI_SPEAKER, USER_SPEAKER } from "../../constants";
import { IChatMsg } from "./local-llm-service";

// 8192-token window minus ~1K reserved for the reply, at 3 chars/token (dense JSON-ish
// content tokenizes near 3.3–3.7 chars/token; WebLLM throws rather than truncating).
export const DEFAULT_PROMPT_BUDGET_CHARS = (8192 - 1024) * 3;
const MAX_TRANSCRIPT_TURNS = 6;
const NO_THINK = "/no_think";
const THINK = "/think";
// Both switch tokens, so trim's switch-preservation logic can recognize whichever one the
// prompt was built with without hardcoding a single value.
const THINK_SWITCHES = [NO_THINK, THINK];

const SEED_HEADER = "### Selected graph data:";
const SEED_VALUES_PREFIX = "Values";
const DIGEST_HEADER = "### Datasets (schema):";

export interface ILocalPromptInput { toolDocs: string; schemaDigest: string; graphSeed: string; thinking?: boolean; }

export const buildLocalSystemPrompt = (input: ILocalPromptInput): string => {
  const parts = [
    localLlmInstructions.trim(),
    `### Tools:\n${input.toolDocs}`,
    `${DIGEST_HEADER}\n${input.schemaDigest || "(no datasets open)"}`,
  ];
  if (input.graphSeed) parts.push(`${SEED_HEADER}\n${input.graphSeed}`);
  const thinkSwitch = input.thinking ? THINK : NO_THINK;
  return `${parts.join("\n\n")}\n\n${thinkSwitch}`;
};

export const buildTranscriptTurns = (
  messages: readonly { speaker: string; messageContent: { content: string; kind?: string } }[]
): IChatMsg[] =>
  messages
    // Status announcements (load progress/ready/failure, WebGPU notices, cancel confirmations,
    // local error messages) are DAVAI-speaker rows too, but they are UI chatter, not model
    // conversation — including them would feed the small model ~100% status noise on the first
    // turn after load and burn the prompt budget. Drop them here.
    .filter((m) => m.messageContent.kind !== "announcement")
    .filter((m) => m.speaker === USER_SPEAKER || m.speaker === DAVAI_SPEAKER)
    .slice(-MAX_TRANSCRIPT_TURNS)
    .map((m) => ({
      role: m.speaker === USER_SPEAKER ? "user" as const : "assistant" as const,
      content: m.messageContent.content,
    }));

// Trim priority v2: (1) drop the seed VALUES line (structure/adornments stay), (2) drop
// oldest transcript turns, (3) truncate the schema digest. Instructions and tool docs are
// never trimmed — they are the capability surface. Whichever think-switch (/no_think or
// /think) the prompt ends with always survives (re-appended).
export const trimToBudget = (messages: IChatMsg[], maxChars = DEFAULT_PROMPT_BUDGET_CHARS): IChatMsg[] => {
  const total = (msgs: IChatMsg[]) => msgs.reduce((n, m) => n + m.content.length, 0);
  const out = messages.map((m) => ({ ...m }));
  if (total(out) <= maxChars) return out;

  const sys = () => out[0];

  // 1. Drop the seed values line.
  const seedIdx = sys().content.indexOf(SEED_HEADER);
  if (seedIdx >= 0) {
    const lines = sys().content.split("\n");
    const valuesLine = lines.findIndex((l, i) => l.startsWith(SEED_VALUES_PREFIX) && lines.slice(0, i).some((p) => p.startsWith(SEED_HEADER)));
    if (valuesLine >= 0) {
      lines[valuesLine] = "[graph values omitted — use get_case_values if needed]";
      out[0] = { ...sys(), content: lines.join("\n") };
    }
  }
  // 2. Drop oldest transcript turns (out[0] system, last = current user message).
  while (total(out) > maxChars && out.length > 2) out.splice(1, 1);
  // 3. Truncate the schema digest section tail.
  if (total(out) > maxChars) {
    const others = total(out.slice(1));
    const room = Math.max(0, maxChars - others - 64);
    const content = sys().content;
    const keep = content.slice(0, room);
    const trailingSwitch = THINK_SWITCHES.find((s) => content.endsWith(s));
    const switchSuffix = trailingSwitch ? `\n${trailingSwitch}` : "";
    out[0] = { ...sys(), content: `${keep}\n[schema digest truncated]${switchSuffix}` };
  }
  return out;
};
