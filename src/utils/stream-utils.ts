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

    // Find the next sentence end or newline.
    const match = trimmedStart.match(/[.!?](?=\s|$)|\n/);
    if (!match || match.index === undefined) break;
    const end = match[0] === "\n" ? match.index : match.index + 1;
    const piece = trimmedStart.slice(0, end).trim();
    if (piece) chunks.push(piece);
    rest = trimmedStart.slice(end + (match[0] === "\n" ? 1 : 0));
    if (leadWs && chunks.length === 0) rest = leadWs + rest;
  }

  return { chunks, remainder: rest };
}
