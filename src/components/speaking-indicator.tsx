import React from "react";
import { useIsSpeaking, useSpeechService, useCurrentSpeechText } from "../contexts/speech-service-context";
import { useAppConfigContext } from "../contexts/app-config-context";

import "./speaking-indicator.scss";

export const SpeakingIndicator: React.FC = () => {
  const appConfig = useAppConfigContext();
  const isSpeaking = useIsSpeaking();
  const speechService = useSpeechService();
  const currentSpeechText = useCurrentSpeechText();

  // Don't show indicator for "Processing" messages - they're brief and transient
  const isProcessingMessage = currentSpeechText?.trim().toLowerCase().startsWith("processing");

  if (!appConfig.readAloudEnabled || !isSpeaking || isProcessingMessage) {
    return null;
  }

  const handleStopClick = () => {
    speechService.stopSpeech();
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
