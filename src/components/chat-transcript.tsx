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
    <ul
      aria-label="DAVAI Chat Transcript"
      className="chat-transcript"
      data-testid="chat-transcript"
      role="main"
    >
      {chatTranscript.messages.map((message: ChatMessage) => {
        return (
          <li
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
          </li>
        );
      })}
    </ul>
  );
};
