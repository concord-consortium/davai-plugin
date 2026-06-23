import { ChatMessage } from "../types";
import { DEBUG_SPEAKER } from "../constants";

interface CaptureMeta {
  capturedAt: string;
  llmLabel: string;
}

export function formatTranscriptForCapture(messages: ChatMessage[], meta: CaptureMeta): string {
  const header = [
    "DAVAI Chat Transcript",
    `Captured: ${meta.capturedAt}`,
    `LLM: ${meta.llmLabel}`,
  ].join("\n");

  const blocks = messages.map((message) => {
    const heading = `${message.speaker} (${message.timestamp}):`;
    if (message.speaker === DEBUG_SPEAKER) {
      const { description, content } = message.messageContent;
      return [heading, description, content].filter(Boolean).join("\n");
    }
    return `${heading}\n${message.plainTextContent}`;
  });

  return [header, ...blocks].join("\n\n") + "\n";
}

export function getLlmLabel(llmId: string): string {
  try {
    const parsed = JSON.parse(llmId);
    if (parsed && typeof parsed.id === "string") {
      return parsed.provider ? `${parsed.provider}: ${parsed.id}` : parsed.id;
    }
  } catch {
    // fall through to default
  }
  return "Unknown LLM";
}

export function getTranscriptFilename(llmId: string, now: Date): string {
  const datePart = formatDateForFilename(now);
  const idPart = sanitizeForFilename(parseLlmIdForFilename(llmId));
  return `davai-transcript-${datePart}-${idPart}.txt`;
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
