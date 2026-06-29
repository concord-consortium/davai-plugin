import React from "react";
import { useIsSpeaking, useSpeechService, useCurrentSpeechText } from "../contexts/speech-service-context";
import { useAppConfigContext } from "../contexts/app-config-context";

import "./speaking-indicator.scss";

interface IProps {
  // True while DAVAI is in a "Processing…" phase; the indicator hides then, since the
  // spoken "Processing" announcement (via speakIfIdle) no longer sets currentSpeechText.
  isProcessing?: boolean;
}

export const SpeakingIndicator: React.FC<IProps> = ({ isProcessing }) => {
  const appConfig = useAppConfigContext();
  const isSpeaking = useIsSpeaking();
  const speechService = useSpeechService();
  const currentSpeechText = useCurrentSpeechText();

  // Don't show the indicator for the transient "Processing" announcement.
  const isProcessingMessage = currentSpeechText?.trim().toLowerCase().startsWith("processing");

  if (!appConfig.readAloudEnabled || !isSpeaking || isProcessing || isProcessingMessage) {
    return null;
  }

  const handleStopClick = () => {
    // Suppress (not just stop) so chunks streamed in afterward don't resume speech —
    // parity with the Escape key. A new response lifts the suppression.
    speechService.stopAndSuppress();
  };

  return (
    <div
      className="speaking-indicator"
      role="status"
      data-testid="speaking-indicator"
    >
      <span className="speaking-icon" aria-hidden="true"></span>
      <span className="speaking-text">Speaking...</span>
      <button
        type="button"
        className="stop-button"
        onClick={handleStopClick}
        aria-label="Stop speech"
        data-testid="stop-speech-button"
      >
        Stop
      </button>
    </div>
  );
};
