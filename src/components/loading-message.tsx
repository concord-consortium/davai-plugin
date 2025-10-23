import React, { useEffect } from "react";
import { observer } from "mobx-react-lite";
import { DAVAI_SPEAKER } from "../constants";
import { useAriaLive } from "../contexts/aria-live-context";
import { useAppConfigContext } from "../contexts/app-config-context";

export const LoadingMessage = observer(function LoadingMessage() {
  const {setAriaLiveText} = useAriaLive();
  const { playProcessingMessage } = useAppConfigContext();

  useEffect(() => {
    if (playProcessingMessage) {
      setAriaLiveText("Processing");
      let isAlternate = false;

      const interval = setInterval(() => {
        // alternate with non-breaking space so screen readers will re-announce the message
        isAlternate = !isAlternate;
        const processingMessage = isAlternate ? "Processing\u00a0" : "Processing";
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
});
