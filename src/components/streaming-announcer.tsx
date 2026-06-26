import React, { useEffect, useRef, useState } from "react";
import { observer } from "mobx-react-lite";
import { ChatTranscript } from "../types";
import { useSpeechService } from "../contexts/speech-service-context";
import { extractCompletedChunks } from "../utils/stream-utils";

interface IProps { transcript: ChatTranscript; }

// Observes the single streaming DAVAI message and drives streamed a11y output:
// each newly-completed sentence/bullet is spoken (queued, never interrupting) and
// appended as a separate node in a polite live region (screen readers queue these).
export const StreamingAnnouncer = observer(({ transcript }: IProps) => {
  const speechService = useSpeechService();
  const [nodes, setNodes] = useState<{ key: string; text: string }[]>([]);
  const consumedRef = useRef(0);
  const idRef = useRef<string | undefined>(undefined);

  // Track the streaming message BY ID so we still see it after it finalizes
  // (isStreaming flips to false) and can flush its final sentence.
  const streaming = transcript.messages.find((m) => m.isStreaming);
  if (streaming && streaming.id !== idRef.current) {
    idRef.current = streaming.id;       // adjust refs during render (allowed for prop-derived state)
    consumedRef.current = 0;
  }
  const tracked = idRef.current ? transcript.messages.find((m) => m.id === idRef.current) : undefined;
  const trackedContent = tracked?.messageContent.content ?? "";
  const trackedDone = tracked ? !tracked.isStreaming : false;

  // New streaming message → clear the previous nodes.
  useEffect(() => {
    setNodes([]);
  }, [streaming?.id]);

  // If the tracked streaming message was removed (discarded on a mixed text+tool
  // turn), stop any queued speech for it and reset.
  useEffect(() => {
    if (idRef.current && !tracked) {
      speechService.stopSpeech();
      idRef.current = undefined;
      setNodes([]);
    }
  }, [tracked, speechService]);

  // Emit newly-completed chunks; on finalize, force-flush the remaining tail.
  useEffect(() => {
    if (!idRef.current || !tracked) return;
    const pending = trackedContent.slice(consumedRef.current);
    const { chunks, remainder } = extractCompletedChunks(pending);
    const tail = trackedDone && remainder.trim() ? [remainder.trim()] : [];
    const toEmit = [...chunks, ...tail];
    if (toEmit.length > 0) {
      consumedRef.current = trackedDone ? trackedContent.length : trackedContent.length - remainder.length;
      for (const text of toEmit) speechService.enqueue(text);
      const base = consumedRef.current;
      setNodes((prev) => [
        ...prev.slice(-9), // prune to keep the DOM small
        ...toEmit.map((text, i) => ({ key: `${idRef.current}-${base}-${i}`, text })),
      ]);
    }
    if (trackedDone) idRef.current = undefined; // stop tracking once finalized + flushed
  }, [tracked, trackedContent, trackedDone, speechService]);

  return (
    <div className="visually-hidden" aria-live="polite" aria-atomic="false">
      {nodes.map((n) => <div key={n.key}>{n.text}</div>)}
    </div>
  );
});
