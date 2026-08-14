// Coerce an LLM message `content` to plain text. Anthropic content can be a
// content-block array; we keep only text blocks so the client always diffs a string.
export function messageTextToString(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((block: any) => (block && block.type === "text" && typeof block.text === "string" ? block.text : ""))
      .join("");
  }
  return "";
}

const FLUSH_BOUNDARY = /[.!?\n]/;
const MAX_UNWRITTEN = 200;

// Decide whether to write a streaming partial yet: flush on a sentence end or
// newline in the newly-added text, or once an unpunctuated run gets long.
export function shouldFlush(fullText: string, lastWrittenLength: number): boolean {
  const added = fullText.slice(lastWrittenLength);
  if (added.length === 0) return false;
  if (added.length >= MAX_UNWRITTEN) return true;
  return FLUSH_BOUNDARY.test(added);
}

// For a mixed text+tool turn, the terminal tool-call payload (requires_action) carries
// no `response` text, but the model may have emitted user-facing text before the tool
// call. Attach that accumulated text so the client can finalize it even if it never
// polled a transient streaming update (streaming display off, or text + tool call landed
// within one poll interval). A plain text completion already has `response` and is left
// untouched.
export function withAccumulatedResponse(
  output: Record<string, unknown>,
  accumulated: string
): Record<string, unknown> {
  if (typeof output.response !== "string" && accumulated) {
    return { ...output, response: accumulated };
  }
  return output;
}

// Distinguish a user/cancel-initiated abort (don't mark the job "error") from a
// real failure. An aborted in-node invoke throws under app.stream().
export function isAbortError(error: unknown, signal: AbortSignal): boolean {
  if (signal.aborted) return true;
  const name = (error as any)?.name;
  const message = (error as any)?.message;
  return (typeof name === "string" && /abort/i.test(name)) ||
         (typeof message === "string" && /abort/i.test(message));
}
