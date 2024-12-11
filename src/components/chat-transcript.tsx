import React, { useRef, useEffect } from "react";
import { observer } from "mobx-react-lite";
import Markdown from "react-markdown";
import { DAVAI_SPEAKER } from "../constants";
import { ChatTranscript, ChatMessage } from "../types";

import "./chat-transcript.scss";

interface IProps {
  chatTranscript: ChatTranscript;
}

export const ChatTranscriptComponent = observer(({chatTranscript}: IProps) => {
  const chatTranscriptRef = useRef<HTMLElement>(null);

  useEffect(() => {
    // Autoscroll to the top of the latest message in the transcript.
    const chatTranscriptContainer = chatTranscriptRef.current;
    if (chatTranscriptContainer) {
      const lastMessage = chatTranscriptContainer.querySelector(".chat-transcript__message:last-of-type");
      lastMessage?.scrollIntoView({behavior: "smooth"});
    }
  }, [chatTranscript.messages.length]);

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
          const messageContentClass = message.speaker === DAVAI_SPEAKER
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
              <h3 data-testid="chat-message-speaker">
                {message.speaker}
              </h3>
              <div
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
});
