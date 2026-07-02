import React, { useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { DEBUG_SPEAKER } from "../constants";
import { ChatMessage } from "../types";
import { useAriaLive } from "../contexts/aria-live-context";

interface IProps {
  message: ChatMessage;
  showDebugLog: boolean;
}

// react-markdown requires a string for `children`. Coerce defensively so a
// non-string content (e.g. an Anthropic content-block array) can never hard-crash
// the whole transcript; extract text blocks when given an array.
export function toMarkdownString(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((block: any) => (block && typeof block.text === "string" ? block.text : "")).join("");
  }
  return content == null ? "" : String(content);
}

export const ChatTranscriptMessage = ({message, showDebugLog}: IProps) => {
  const { setAriaLiveText } = useAriaLive();
  const { speaker, messageContent } = message;
  const [showMessage, setShowMessage] = useState(false);

  if (speaker === DEBUG_SPEAKER && !showDebugLog) {
    return null;
  }

  const handleToggleMessage = () => {
    const newState = !showMessage;
    setShowMessage(newState);
    if (newState) {
      setAriaLiveText(messageContent.content);
    } else {
      setAriaLiveText("");
    }
  };

  const renderDebugPreview = () => {
    const expandedClass = showMessage ? "expanded" : "collapsed";
    return (
      <div className={`debug-message-wrapper ${expandedClass}`}>
        <button
          type="button"
          aria-expanded={showMessage}
          aria-controls="debug-message-content"
          onClick={handleToggleMessage}
        >
          <span aria-hidden="true" className="arrow-icon">▼</span>
          {messageContent.description}
        </button>
        <pre
          id="debug-message-content"
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
          <Markdown remarkPlugins={[remarkGfm]}>{toMarkdownString(messageContent.content)}</Markdown>
        }
      </div>
    </div>
  );
};
