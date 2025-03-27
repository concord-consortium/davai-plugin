import React, { useState } from "react";
import Markdown from "react-markdown";
import { DEBUG_SPEAKER } from "../constants";
import { ChatMessage } from "../types";
import { formatTime } from "../utils/utils";

interface IProps {
  message: ChatMessage;
  showDebugLog: boolean;
}

export const ChatTranscriptMessage = ({message, showDebugLog}: IProps) => {
  const { speaker, messageContent } = message;
  const [showMessage, setShowMessage] = useState(false);

  if (speaker === DEBUG_SPEAKER && !showDebugLog) {
    return null;
  }

  const renderDebugPreview = () => {
    const expandedClass = showMessage ? "expanded" : "collapsed";
    return (
      <div className={`debug-message-wrapper ${expandedClass}`}>
        <div className="debug-message-header">
          <label htmlFor="debug-message-toggle" className="visually-hidden">
            {showMessage ? "Collapse" : "Expand"}
          </label>
          <input
            type="checkbox"
            role="switch"
            aria-checked={showMessage}
            id={"debug-message-toggle"}
            className="debug-message-toggle"
            onClick={() => setShowMessage(!showMessage)}
          />
          <h4>{messageContent.description}:</h4>
        </div>
        <pre
          aria-expanded={showMessage}
        >
            {messageContent.content}
        </pre>
      </div>
    );
  };

  const speakerClass = speaker === DEBUG_SPEAKER ? "debug" : speaker.toLowerCase();

  return (
    <div
      aria-label={speaker}
      className={`chat-transcript__message ${speakerClass}`}
      data-testid="chat-message"
      role="listitem"
    >
      <div className="chat-message-header">
        <h3 data-testid="chat-message-speaker">
          {speaker}
        </h3>
        <span className="chat-message-time">
          {formatTime(message.timestamp, speaker === DEBUG_SPEAKER)}
        </span>
      </div>
      <div
        className={`chat-message-content ${speakerClass}`}
        data-testid="chat-message-content"
      >
        {speaker === DEBUG_SPEAKER ?
          renderDebugPreview() :
          <Markdown>{messageContent.content}</Markdown>
        }
      </div>
    </div>
  );
};
