import React from "react";
import { DAVAI_SPEAKER } from "../constants";
import { timeStamp } from "../utils/utils";

export const LoadingMessage = () => {
  return (
    <section
      aria-label={`${DAVAI_SPEAKER} at ${timeStamp()}`}
      className={`chat-transcript__message ${DAVAI_SPEAKER.toLowerCase()}`}
      data-testid="chat-message"
      role="listitem"
    >
      <h3 aria-label="speaker" data-testid="chat-message-speaker">
        {DAVAI_SPEAKER}
      </h3>
      <div
        aria-label="message"
        className={`chat-message-content ${DAVAI_SPEAKER.toLowerCase()}`}
        data-testid="chat-message-content"
      >
        <div
          aria-label="Loading response, please wait"
          className="loading"
          data-testid="loading" role="status" aria-live="polite"
        >
        </div>
      </div>
    </section>
  );
};
