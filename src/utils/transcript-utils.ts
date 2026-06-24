import { strToU8, zipSync } from "fflate";
import { ChatMessage } from "../types";
import { DEBUG_SPEAKER } from "../constants";

// CSV columns. Debug-log rows put their event description in "debug event";
// DAVAI/User rows leave it blank.
const CSV_HEADER = ["timestamp", "speaker", "debug event", "message"];

// Matches a base64 image data URI (e.g. CODAP's graph exportDataUri). The base64
// run ends at the first non-base64 char (e.g. the closing quote in the debug JSON).
const IMAGE_DATA_URI_RE = /data:image\/[A-Za-z0-9.+-]+;base64,[A-Za-z0-9+/=]+/g;

export interface CapturedImage {
  /** File name within the zip's images/ folder, e.g. "image-001.png". */
  filename: string;
  bytes: Uint8Array;
}

export interface TranscriptCapture {
  /** CSV text, with image data URIs replaced by images/<filename> references. */
  csv: string;
  /** Decoded images referenced by the CSV, de-duplicated by content. */
  images: CapturedImage[];
}

export function buildTranscriptCsv(messages: ChatMessage[]): TranscriptCapture {
  const images: CapturedImage[] = [];
  const refByDataUri = new Map<string, string>();

  // Replace each base64 image with a stable images/<filename> reference, decoding
  // the bytes once per unique image so identical images share a single file.
  const replaceImages = (text: string): string =>
    text.replace(IMAGE_DATA_URI_RE, (dataUri) => {
      const existingRef = refByDataUri.get(dataUri);
      if (existingRef) return existingRef;
      const filename = `image-${String(images.length + 1).padStart(3, "0")}.${imageExtFromDataUri(dataUri)}`;
      images.push({ filename, bytes: dataUriToBytes(dataUri) });
      const ref = `images/${filename}`;
      refByDataUri.set(dataUri, ref);
      return ref;
    });

  const rows = messages.map((message) => {
    const isDebug = message.speaker === DEBUG_SPEAKER;
    const debugEvent = isDebug ? message.messageContent.description ?? "" : "";
    const rawBody = isDebug ? message.messageContent.content : message.plainTextContent;
    return [message.timestamp, message.speaker, debugEvent, replaceImages(rawBody ?? "")];
  });

  const csv = [CSV_HEADER, ...rows].map(toCsvRow).join("\r\n") + "\r\n";
  return { csv, images };
}

/** Bundle the CSV (as transcript.csv) and its images (under images/) into a zip. */
export function buildTranscriptZip(capture: TranscriptCapture): Uint8Array {
  const files: Record<string, Uint8Array> = { "transcript.csv": strToU8(capture.csv) };
  for (const image of capture.images) {
    files[`images/${image.filename}`] = image.bytes;
  }
  return zipSync(files);
}

function imageExtFromDataUri(dataUri: string): string {
  const mime = dataUri.match(/^data:image\/([A-Za-z0-9.+-]+);base64,/)?.[1]?.toLowerCase();
  if (mime === "jpeg" || mime === "jpg") return "jpg";
  if (mime === "svg+xml") return "svg";
  return mime || "png";
}

function dataUriToBytes(dataUri: string): Uint8Array {
  const binary = atob(dataUri.split(",")[1] ?? "");
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function toCsvRow(fields: string[]): string {
  return fields.map(escapeCsvField).join(",");
}

// RFC 4180: wrap every field in double quotes and double any internal quotes,
// so commas, quotes, and newlines in messages or debug JSON don't break columns.
function escapeCsvField(value: string): string {
  return `"${(value ?? "").replace(/"/g, '""')}"`;
}

export function getTranscriptFilename(llmId: string, now: Date, ext = "csv"): string {
  const datePart = formatDateForFilename(now);
  const idPart = sanitizeForFilename(parseLlmIdForFilename(llmId));
  return `davai-transcript-${datePart}-${idPart}.${ext}`;
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

export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

export function downloadTextFile(filename: string, text: string): void {
  downloadBlob(filename, new Blob([text], { type: "text/plain" }));
}

export async function copyTextToClipboard(text: string): Promise<void> {
  await navigator.clipboard.writeText(text);
}
