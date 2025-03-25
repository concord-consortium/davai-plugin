import React from "react";
import { DAVAI_SPEAKER } from "../constants";

export const LoadingMessage = () => {
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
        <div
          aria-label="Loading response, please wait"
          className="loading"
          data-testid="loading" role="status" aria-live="polite"
        >
          Processing
        </div>
      </div>
    </div>
  );
};
