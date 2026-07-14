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
const DIGEST_TRUNCATED_LABEL = "\n[schema digest truncated]";
// Sized from the actual marker strings trimToBudget's step 3 appends after the kept content (the
// label, plus whichever think-switch token gets re-appended) — rather than a hand-counted magic
// number that would silently under-reserve room if either string grows.
const TRIM_MARKER_RESERVE_CHARS =
  DIGEST_TRUNCATED_LABEL.length + Math.max(...THINK_SWITCHES.map((s) => `\n${s}`.length));

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

// Trim priority: (1) drop the seed VALUES line (structure/adornments stay), (2) drop
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
  // 3. Truncate the schema digest section tail — anchored to the digest header's own offset so
  //    the cut can never precede it. Without this anchor, `room` shrinks with the size of the
  //    CURRENT USER MESSAGE (via `others`, below), so a large enough user turn could drive `room`
  //    below len(instructions + tool docs) and slice straight through the tool documentation —
  //    the model's capability surface — while still labeling the result "[schema digest
  //    truncated]" regardless of what was actually removed.
  if (total(out) > maxChars) {
    const others = total(out.slice(1));
    const content = sys().content;
    const digestIdx = content.indexOf(DIGEST_HEADER);
    // Everything before the digest header (instructions + tool docs) is the untrimmable prefix.
    // Fall back to the whole content if some caller's prompt never carries the header at all —
    // an untrimmed whole prompt overshooting budget is still safer than guessing where to cut it.
    const prefixEnd = digestIdx >= 0 ? digestIdx : content.length;
    const room = Math.max(prefixEnd, maxChars - others - TRIM_MARKER_RESERVE_CHARS);
    // Clamped to prefixEnd: if even the untrimmable prefix alone exceeds room, keep it whole
    // anyway — instructions + tool docs are the capability surface a local model needs to do
    // anything useful at all; overshooting the char budget slightly beats silently disabling
    // every tool call.
    const keep = content.slice(0, room);
    const trailingSwitch = THINK_SWITCHES.find((s) => content.endsWith(s));
    const switchSuffix = trailingSwitch ? `\n${trailingSwitch}` : "";
    // The label is honest unconditionally: this rung only ever removes digest/seed tail, never
    // the instructions/tool-docs prefix above.
    out[0] = { ...sys(), content: `${keep}${DIGEST_TRUNCATED_LABEL}${switchSuffix}` };
  }
  return out;
};
