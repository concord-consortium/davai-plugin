import { ChatMessage } from "../types";
import { DEBUG_SPEAKER } from "../constants";

// CSV columns. Debug-log rows put their event description in "debug event";
// DAVAI/User rows leave it blank.
const CSV_HEADER = ["timestamp", "speaker", "debug event", "message"];

export function formatTranscriptForCapture(messages: ChatMessage[]): string {
  const rows = messages.map((message) => {
    const isDebug = message.speaker === DEBUG_SPEAKER;
    const debugEvent = isDebug ? message.messageContent.description ?? "" : "";
    const body = isDebug ? message.messageContent.content : message.plainTextContent;
    return [message.timestamp, message.speaker, debugEvent, body];
  });

  return [CSV_HEADER, ...rows].map(toCsvRow).join("\r\n") + "\r\n";
}

function toCsvRow(fields: string[]): string {
  return fields.map(escapeCsvField).join(",");
}

// RFC 4180: wrap every field in double quotes and double any internal quotes,
// so commas, quotes, and newlines in messages or debug JSON don't break columns.
function escapeCsvField(value: string): string {
  return `"${(value ?? "").replace(/"/g, '""')}"`;
}

export function getTranscriptFilename(llmId: string, now: Date): string {
  const datePart = formatDateForFilename(now);
  const idPart = sanitizeForFilename(parseLlmIdForFilename(llmId));
  return `davai-transcript-${datePart}-${idPart}.csv`;
}

function formatDateForFilename(now: Date): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseLlmIdForFilename(llmId: string): string {
  try {
    const parsed = JSON.parse(llmId);
    if (parsed && typeof parsed.id === "string" && parsed.id.trim()) {
      return parsed.id;
    }
  } catch {
    // fall through to default
  }
  return "unknown-llm";
}

function sanitizeForFilename(value: string): string {
  return value.replace(/[^a-zA-Z0-9.-]/g, "-");
}

export function downloadTextFile(filename: string, text: string): void {
  const blob = new Blob([text], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

export async function copyTextToClipboard(text: string): Promise<void> {
  await navigator.clipboard.writeText(text);
}
