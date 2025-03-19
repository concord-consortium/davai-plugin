import React, { useEffect } from "react";
import { DAVAI_SPEAKER } from "../constants";
import { timeStamp } from "../utils/utils";
import * as Tone from "tone";

interface IProps {
  playProcessingTone: boolean;
}

export const LoadingMessage = ({ playProcessingTone }: IProps) => {
  const playSound = () => {
    const synth = new Tone.Synth().toDestination();
    synth.triggerAttackRelease("C4", "8n");
  };

  useEffect(() => {
    let interval: NodeJS.Timeout | undefined;

    if (playProcessingTone) {
      playSound();
      interval = setInterval(playSound, 2000);
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
