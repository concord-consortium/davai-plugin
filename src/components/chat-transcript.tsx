import React, { useRef, useEffect } from "react";
import Markdown from "react-markdown";

import { ChatTranscript, ChatMessage } from "../types";

import "./chat-transcript.scss";

interface IProps {
  chatTranscript: ChatTranscript;
}

export const ChatTranscriptComponent = ({chatTranscript}: IProps) => {
  const chatTranscriptRef = useRef<HTMLElement>(null);

  useEffect(() => {
    // Always scroll to the bottom of the chat transcript.
    const chatTranscriptContainer = chatTranscriptRef.current;
    if (chatTranscriptContainer) {
      const lastMessage = chatTranscriptContainer.querySelector(".chat-transcript__message:last-of-type");
      lastMessage?.scrollIntoView({behavior: "smooth"});
    }
  }, [chatTranscript]);

  return (
    <section ref={chatTranscriptRef} id="chat-transcript" className="chat-transcript" data-testid="chat-transcript" role="group">
      <h2 className="visually-hidden">DAVAI Chat Transcript</h2>
      <section
        // For now we are using "assertive". This may change as we refine the experience.
        aria-live="assertive"
        className="chat-transcript__messages"
        data-testid="chat-transcript__messages"
        role="list"
      >
        {chatTranscript.messages.map((message: ChatMessage) => {
          const messageContentClass = message.speaker === "DAVAI"
            ? "chat-message-content--davai"
            : "chat-message-content--user";
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
              <div
                aria-label="message"
                className={`chat-message-content ${messageContentClass}`}
                data-testid="chat-message-content"
              >
                <Markdown>{message.content}</Markdown>
              </div>
            </section>
          );
        })}
      </section>
    </section>
  );
};
