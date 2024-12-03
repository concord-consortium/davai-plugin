import React, { useEffect } from "react";

import { ChatTranscript, ChatMessage } from "../types";

import "./chat-transcript.scss";

interface IProps {
  chatTranscript: ChatTranscript;
}

export const ChatTranscriptComponent = ({chatTranscript}: IProps) => {

  useEffect(() => {
    // Always scroll to the bottom of the chat transcript.
    const chatTranscriptContainer = document.querySelector(".chat-transcript");
    if (chatTranscriptContainer) {
      chatTranscriptContainer.scrollTop = chatTranscriptContainer.scrollHeight;
    }
  });

  return (
    <section id="chat-transcript" className="chat-transcript" data-testid="chat-transcript" role="group">
      <h2 className="visually-hidden">DAVAI Chat Transcript</h2>
      <section
        // For now we are using "assertive". This may change as we refine the experience.
        aria-live="assertive"
        className="chat-transcript__messages"
        data-testid="chat-transcript__messages"
        role="list"
      >
        {chatTranscript.messages.map((message: ChatMessage) => {
          return (
            <section
              aria-label={`${message.speaker} at ${message.timestamp}`}
              className="chat-transcript__message"
              data-testid="chat-message"
              key={message.timestamp}
              role="listitem"
            >
              <h3 aria-label="speaker" data-testid="chat-message-speaker">
                {message.speaker}
              </h3>
              <p aria-label="message" data-testid="chat-message-content">
                {message.content}
              </p>
            </section>
          );
        })}
      </section>
    </section>
  );
};
