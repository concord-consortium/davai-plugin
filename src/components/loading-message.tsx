import React, { useEffect, useState } from "react";
import { observer } from "mobx-react-lite";
import { DAVAI_SPEAKER } from "../constants";
import { useAppConfigContext } from "../contexts/app-config-context";
import { useSpeechService } from "../contexts/speech-service-context";

export const LoadingMessage = observer(function LoadingMessage() {
  const { playProcessingMessage } = useAppConfigContext();
  const speechService = useSpeechService();
  const [announce, setAnnounce] = useState("");

  useEffect(() => {
    if (!playProcessingMessage) return;
    let isAlternate = false;
    const tick = () => {
      // TTS: only speak when idle, so the looping "Processing" never cuts off streamed
      // speech. It repeats while a tool phase runs and pauses while text is spoken.
      speechService.speakIfIdle("Processing");
      // Screen reader: a polite (not assertive) region so it doesn't clobber streamed
      // text; alternate a non-breaking space to force re-announcement of the same string.
      isAlternate = !isAlternate;
      setAnnounce(isAlternate ? "Processing " : "Processing");
    };
    tick();
    const interval = setInterval(tick, 4000);
    return () => clearInterval(interval);
  }, [playProcessingMessage, speechService]);

  return (
    <div
      aria-label={DAVAI_SPEAKER}
      className={`chat-transcript__message ${DAVAI_SPEAKER.toLowerCase()}`}
      data-testid="chat-message"
      role="listitem"
    >
      <h3 data-testid="chat-message-speaker">
        {DAVAI_SPEAKER}
      </h3>
      <div
        className={`chat-message-content ${DAVAI_SPEAKER.toLowerCase()}`}
        data-testid="chat-message-content"
      >
        <div className="loading">
          Processing
        </div>
      </div>
      <div className="visually-hidden" role="status" aria-live="polite">
        {announce}
      </div>
    </div>
  );
});
