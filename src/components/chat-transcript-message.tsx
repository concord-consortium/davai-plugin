import React, { useState } from "react";
import Markdown from "react-markdown";
import { DEBUG_SPEAKER } from "../constants";
import { ChatMessage } from "../types";

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
        <div className="header">
          <button
            onClick={() => setShowMessage(!showMessage)}
          >
            <span>{showMessage ? "Collapse content" : "Expand content"}</span>
          </button>
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
      <h3 data-testid="chat-message-speaker">
        {speaker}
      </h3>
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
