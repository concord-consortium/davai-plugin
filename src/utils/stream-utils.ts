export function appendedText(shown: string, cumulative: string): string {
  return cumulative.startsWith(shown) ? cumulative.slice(shown.length) : cumulative;
}

const FENCE = "```";

// Split a buffer into completed sentence/list-item chunks for speech and screen-reader
// announcement, holding the trailing incomplete unit (and any open code fence) as remainder.
export function extractCompletedChunks(buffer: string): { chunks: string[]; remainder: string } {
  const chunks: string[] = [];
  let rest = buffer;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const trimmedStart = rest.replace(/^\s+/, "");
    const leadWs = rest.slice(0, rest.length - trimmedStart.length);

    if (trimmedStart.startsWith(FENCE)) {
      // Code block: only flush when the closing fence + newline is present.
      const close = trimmedStart.indexOf(FENCE, FENCE.length);
      const afterClose = close === -1 ? -1 : trimmedStart.indexOf("\n", close + FENCE.length);
      if (afterClose === -1) break; // unclosed → keep whole thing as remainder
      chunks.push(trimmedStart.slice(0, afterClose).trimEnd());
      rest = trimmedStart.slice(afterClose + 1);
      continue;
    }

    // Skip a leading numbered-list marker (e.g. "1." / "2)") so its period isn't
    // treated as a sentence end — keep "1. Item" together as one chunk.
    const marker = trimmedStart.match(/^\d+[.)]\s+/);
    const searchFrom = marker ? marker[0].length : 0;

    // Find the next sentence end or newline (after any list marker).
    const rel = trimmedStart.slice(searchFrom).match(/[.!?](?=\s|$)|\n/);
    if (!rel || rel.index === undefined) break;
    const isNewline = rel[0] === "\n";
    const matchIndex = searchFrom + rel.index;
    const end = isNewline ? matchIndex : matchIndex + 1;
    const piece = trimmedStart.slice(0, end).trim();
    if (piece) chunks.push(piece);
    rest = trimmedStart.slice(end + (isNewline ? 1 : 0));
    if (leadWs && chunks.length === 0) rest = leadWs + rest;
  }

  return { chunks, remainder: rest };
}
