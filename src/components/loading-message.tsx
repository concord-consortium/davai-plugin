import React, { useEffect } from "react";
import { DAVAI_SPEAKER } from "../constants";
import { timeStamp } from "../utils/utils";
import * as Tone from "tone";

export const LoadingMessage = () => {
  const playSound = () => {
    const synth = new Tone.Synth().toDestination();
    synth.triggerAttackRelease("C4", "8n");
  };

  useEffect(() => {
    playSound();
    const interval = setInterval(playSound, 2000);
    return () => clearInterval(interval);
  }, []);

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
