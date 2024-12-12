import React, { useRef, useEffect } from "react";
import { observer } from "mobx-react-lite";
import { ChatTranscriptMessage } from "./chat-transcript-message";
import { ChatTranscript, ChatMessage } from "../types";
import { LoadingMessage } from "./loading-message";

import "./chat-transcript.scss";

interface IProps {
  chatTranscript: ChatTranscript;
  showDebugLog: boolean;
  isLoading?: boolean;
}

export const ChatTranscriptComponent = observer(({chatTranscript, showDebugLog, isLoading}: IProps) => {
  const chatTranscriptRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Autoscroll to the top of the latest message in the transcript.
    const chatTranscriptContainer = chatTranscriptRef.current;
    if (chatTranscriptContainer) {
      const lastMessage = chatTranscriptContainer.querySelector(".chat-transcript__message:last-of-type");
      lastMessage?.scrollIntoView({behavior: "smooth"});
    }
  }, [chatTranscript.messages.length]);

  return (
    <div ref={chatTranscriptRef} id="chat-transcript" className="chat-transcript" data-testid="chat-transcript" role="group">
      <h2 className="visually-hidden">DAVAI Chat Transcript</h2>
      <div
        // For now we are using "assertive". This may change as we refine the experience.
        aria-live="assertive"
        className="chat-transcript__messages"
        data-testid="chat-transcript__messages"
        role="list"
      >
        {chatTranscript.messages.map((message: ChatMessage) => {
          return (
            <ChatTranscriptMessage
              key={`${message.id}`}
              message={message}
              showDebugLog={showDebugLog}
            />
          );
        })}
        {isLoading && <LoadingMessage />}
      </div>
    </div>
  );
});
