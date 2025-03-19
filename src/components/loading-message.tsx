import React, { useEffect } from "react";
import { DAVAI_SPEAKER, LOADING_NOTE } from "../constants";
import { playSound, timeStamp } from "../utils/utils";

interface IProps {
  playProcessingTone: boolean;
}

export const LoadingMessage = ({ playProcessingTone }: IProps) => {
  useEffect(() => {
    let interval: NodeJS.Timeout | undefined;

    if (playProcessingTone) {
      playSound(LOADING_NOTE);
      interval = setInterval(() => playSound(LOADING_NOTE), 2000);
    }

    return () => {
      if (interval) {
        clearInterval(interval);
      }
    };
  }, [playProcessingTone]);

  return (
    <div
      aria-label={`${DAVAI_SPEAKER} at ${timeStamp()}`}
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
