import React, { useRef, useEffect } from "react";
import { observer } from "mobx-react-lite";
import { ChatTranscriptMessage } from "./chat-transcript-message";
import { ChatTranscript, ChatMessage } from "../types";

import "./chat-transcript.scss";

interface IProps {
  chatTranscript: ChatTranscript;
  showDebugLog: boolean;
}

export const ChatTranscriptComponent = observer(({chatTranscript, showDebugLog}: IProps) => {
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
          return (
            <ChatTranscriptMessage
              key={`${message.timestamp}-${message.speaker}`}
              message={message}
              showDebugLog={showDebugLog}
            />
          );
        })}
      </section>
    </section>
  );
});
