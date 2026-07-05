import { localLlmInstructions } from "../../text/local-llm-instructions";
import { localCodapApiDoc } from "../../text/codap-api-documentation";
import { DAVAI_SPEAKER, USER_SPEAKER } from "../../constants";
import { IChatMsg } from "./local-llm-service";

// 16384-token window minus ~1K reserved for the model's reply. Calibrated at 3 chars/token
// (not the naive 4) because the mirrored DAVAI context — dense JSON with punctuation and
// digits — tokenizes closer to 3.3–3.7 chars/token, and WebLLM throws
// ContextWindowSizeExceededError rather than auto-truncating when the prompt overflows.
export const DEFAULT_PROMPT_BUDGET_CHARS = (16384 - 1024) * 3;
const MAX_TRANSCRIPT_TURNS = 6;

// Qwen3's prompt-level switch to disable thinking mode. Appended AFTER budget trimming so it
// always survives, no matter how aggressively the rest of the system prompt is cut.
const NO_THINK_SUFFIX = "\n\n/no_think";
const API_DOC_TRUNCATED_MARKER = "[api documentation truncated]";
const CONTEXTS_TRUNCATED_MARKER = "[context truncated]";

// The system prompt is assembled from four independently-trimmable parts so the budget guard
// can cut the least-essential content (the static API doc) before it touches the live data
// contexts the model actually needs to answer. Mirrors the server prompt template in
// sam-server/src/utils/llm-utils.ts (instructions + API documentation + current data contexts
// + current graphs).
export interface ISystemPromptParts {
  instructions: string;
  apiDoc: string;
  dataContexts: string;
  graphs: string;
}

export const buildSystemPromptParts = (dataContexts: unknown, graphs: unknown): ISystemPromptParts => ({
  instructions: localLlmInstructions,
  apiDoc: localCodapApiDoc,
  // Compact JSON (no 2-space indent): the mirrored contexts can be several KB and the
  // pretty-printing whitespace is pure budget cost the small model gains nothing from.
  dataContexts: JSON.stringify(dataContexts ?? {}),
  graphs: JSON.stringify(graphs ?? []),
});

// Assemble the four parts into the full system-prompt string (without the trailing /no_think,
// which is appended after trimming). Kept as a named helper so both the untrimmed builder and
// the budget trimmer share one layout.
const assembleSystemPrompt = (parts: ISystemPromptParts): string =>
  `${parts.instructions}

### CODAP API documentation:
${parts.apiDoc}

### Current CODAP Data Contexts:
${parts.dataContexts}

### Current CODAP Graphs:
${parts.graphs}`;

// Back-compat builder for the existing call site: the full mirrored system prompt with
// /no_think appended. runLocalTurn now trims from parts instead of consuming this string, but
// this remains the canonical "what the untrimmed prompt looks like" for tests and any direct
// caller.
export const buildLocalSystemPrompt = (dataContexts: unknown, graphs: unknown): string =>
  `${assembleSystemPrompt(buildSystemPromptParts(dataContexts, graphs))}${NO_THINK_SUFFIX}`;

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

// Truncate `text` to fit `room` characters, appending `marker` (never producing a negative
// slice). Returns "" (marker dropped too) if there isn't even room for the marker.
const truncateWithMarker = (text: string, room: number, marker: string): string => {
  if (room <= 0) return "";
  if (text.length <= room) return text;
  const body = Math.max(0, room - marker.length - 1);
  return `${text.slice(0, body)}\n${marker}`;
};

// Budget guard for the whole message array. Trims in priority order so the model keeps what it
// needs to answer:
//   1. drop the static API documentation entirely (replaced by a marker), keeping instructions
//      + live contexts intact — the doc is the biggest, least-essential block, and the small
//      model does better with a full data view and no docs than a clipped view with docs;
//   2. then drop the oldest transcript turns (keep the most recent turn for continuity);
//   3. only as a last resort truncate the live data contexts/graphs tail (marker).
// /no_think is re-appended to the system message after trimming so it always survives.
export const trimToBudget = (
  parts: ISystemPromptParts,
  turns: IChatMsg[],
  maxChars = DEFAULT_PROMPT_BUDGET_CHARS
): IChatMsg[] => {
  const working: ISystemPromptParts = { ...parts };
  const transcript = [...turns];

  const buildSystem = (): IChatMsg => ({
    role: "system",
    content: `${assembleSystemPrompt(working)}${NO_THINK_SUFFIX}`,
  });
  const transcriptChars = () => transcript.reduce((n, m) => n + m.content.length, 0);
  const total = () => buildSystem().content.length + transcriptChars();
  // The system-prompt scaffold length with the variable parts blanked out, so we can compute
  // exactly how much room the (contexts + graphs) tail may occupy once the doc is gone.
  const fixedSystemCharsWithoutContexts = () => {
    const skeleton = assembleSystemPrompt({
      instructions: working.instructions,
      apiDoc: API_DOC_TRUNCATED_MARKER,
      dataContexts: "",
      graphs: "",
    });
    return skeleton.length + NO_THINK_SUFFIX.length;
  };

  // 1. Cut the API documentation entirely (down to a marker). It is by far the largest static
  // block; dropping it wholesale rather than partially refilling guarantees the essential
  // instructions + live contexts fit with comfortable headroom.
  if (total() > maxChars) {
    working.apiDoc = API_DOC_TRUNCATED_MARKER;
  }

  // 2. Drop oldest transcript turns, keeping the most recent one for continuity.
  while (total() > maxChars && transcript.length > 1) {
    transcript.shift();
  }

  // 3. Last resort: truncate the data contexts + graphs tail. Contexts is trimmed before
  // graphs (contexts is typically the larger blob); each keeps a marker so the model knows
  // the view was clipped rather than empty.
  if (total() > maxChars) {
    // Room shared by dataContexts + graphs combined.
    const room = maxChars - fixedSystemCharsWithoutContexts() - transcriptChars();
    if (working.graphs.length <= Math.max(0, room)) {
      // Graphs fit; give the remaining room to contexts (with its marker).
      working.dataContexts = truncateWithMarker(working.dataContexts, room - working.graphs.length, CONTEXTS_TRUNCATED_MARKER);
    } else {
      // Even graphs alone overflow: drop contexts entirely and clip graphs to a marker.
      working.dataContexts = CONTEXTS_TRUNCATED_MARKER;
      working.graphs = truncateWithMarker(working.graphs, room, CONTEXTS_TRUNCATED_MARKER);
    }
  }

  return [buildSystem(), ...transcript];
};
