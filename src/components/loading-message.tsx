import React, { useEffect } from "react";
import { DAVAI_SPEAKER } from "../constants";
import { useAriaLive } from "../contexts/aria-live-context";
import { useOptions } from "../hooks/use-options";

export const LoadingMessage = () => {
  const {setAriaLiveText} = useAriaLive();
  const {playProcessingMessage} = useOptions();

  useEffect(() => {
    if (playProcessingMessage) {
      setAriaLiveText("Processing");
      let isAlternate = false;

      const interval = setInterval(() => {
        // alternate between "Processing" and "Processing " so scren readers will read the message
        isAlternate = !isAlternate;
        const processingMessage = isAlternate ? "Processing " : "Processing";
        setAriaLiveText(processingMessage);
      }, 4000);
      return () => clearInterval(interval);
    }
  }, [playProcessingMessage, setAriaLiveText]);

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
    </div>
  );
};
