import removeMarkdown from "remove-markdown";

const STRIP_OPTS = { useImgAltText: true };
const BULLET_RE = /^(\s*)[-*+]\s+(.*)$/;
const NUMBER_RE = /^(\s*)(\d+)[.)]\s+(.*)$/;

// Strip markdown for the screen reader and TTS so formatting symbols aren't read
// aloud (e.g. "asterisk asterisk bold"), while KEEPING a spoken indication of list
// structure: a bullet marker (-, *, +) becomes the spoken word "bullet" and a numbered
// marker (e.g. "1.") is preserved, with the rest of the item's markdown stripped.
// (We say the word "bullet" rather than a "•" glyph, which some TTS voices/VoiceOver
// pronounce as "comma".)
export function forSpeech(text: string): string {
  const bullet = text.match(BULLET_RE);
  if (bullet) return `bullet ${removeMarkdown(bullet[2], STRIP_OPTS)}`;
  const numbered = text.match(NUMBER_RE);
  if (numbered) return `${numbered[2]}. ${removeMarkdown(numbered[3], STRIP_OPTS)}`;
  return removeMarkdown(text, { stripListLeaders: false, ...STRIP_OPTS });
}

// Convert a whole multi-line message to spoken text (for non-streamed responses, which
// arrive all at once). Runs each line through chunkToSpeech with a shared table state,
// so bullets/numbers and markdown tables are voiced the same way as streamed chunks.
export function forSpeechMultiline(text: string): string {
  const state: TableSpeechState = { header: null };
  return text
    .split("\n")
    .map((line) => chunkToSpeech(line, state))
    .filter((s) => s.trim())
    .join("\n");
}

// Parse a markdown table row ("| a | b |") into trimmed cells, or null if not a row.
function parseTableRow(line: string): string[] | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|")) return null;
  const cells = trimmed.split("|").map((c) => c.trim());
  if (cells.length && cells[0] === "") cells.shift();
  if (cells.length && cells[cells.length - 1] === "") cells.pop();
  return cells;
}

// A GFM header-separator row, e.g. |---|:--:|
function isSeparatorRow(cells: string[]): boolean {
  return cells.length > 0 && cells.every((c) => /^:?-{1,}:?$/.test(c));
}

export interface TableSpeechState { header: string[] | null; }

// Convert one streamed chunk to spoken text, linearizing markdown table rows into
// "Header value, Header value, …" using the table's header row (so a screen reader
// and TTS get column context instead of reading "bar … bar"). Header and separator
// rows are skipped (return ""). `state` carries the current table's header across
// chunks; it resets when a non-table chunk is seen.
export function chunkToSpeech(chunk: string, state: TableSpeechState): string {
  const cells = parseTableRow(chunk);
  if (!cells) {
    state.header = null; // table (if any) ended
    return forSpeech(chunk);
  }
  if (isSeparatorRow(cells)) return "";
  const stripped = cells.map((c) => removeMarkdown(c, STRIP_OPTS));
  if (!state.header) {
    state.header = stripped; // first table row = header → store and skip
    return "";
  }
  const header = state.header;
  return stripped
    .map((value, i) => {
      const label = header[i];
      return label ? `${label} ${value}`.trim() : value;
    })
    .filter((s) => s.trim())
    .join(", ");
}
