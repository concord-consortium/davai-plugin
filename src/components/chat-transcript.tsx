import React, { forwardRef, useEffect } from "react";
import { ChatMessage, ChatTranscript } from "../types";

import "./chat-transcript.scss";

interface IProps {
  chatTranscript: ChatTranscript;
}

export const ChatTranscriptComponent = forwardRef<HTMLDivElement, IProps>(({chatTranscript}, ref) => {

  useEffect(() => {
    // Always scroll to the bottom of the chat transcript.
    const chatTranscriptContainer = document.querySelector(".chat-transcript");
    if (chatTranscriptContainer) {
      chatTranscriptContainer.scrollTop = chatTranscriptContainer.scrollHeight;
    }
  });

  return (
    <div ref={ref} className="chat-transcript-container" role="main">
      <p id="chat-transcript-description" className="visually-hidden">
        This is a transcript of a chat with DAVAI.
      </p>
      <div
        aria-label="DAVAI Chat Transcript"
        aria-describedby="chat-transcript-description"
        className="chat-transcript"
        contentEditable="true"
        data-testid="chat-transcript"
        // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
        tabIndex={0}
        onBeforeInput={(e) => e.preventDefault()}
      >
        {chatTranscript.messages.map((message: ChatMessage) => {
          return (
            <div
              aria-label={`${message.speaker} at ${message.timestamp}`}
              // For now we are using "assertive" and only applying aria-live to AI messages. This
              // may change as we refine the experience.
              aria-live={message.speaker === "DAVAI" ? "assertive" : undefined}
              className="chat-transcript__message"
              data-testid="chat-message"
              key={message.timestamp}
            >
              <h2 aria-label="speaker" data-testid="chat-message-speaker">
                {message.speaker}
              </h2>
              <p aria-label="message" data-testid="chat-message-content">
                {message.content}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
});

ChatTranscriptComponent.displayName = "ChatTranscriptComponent";

