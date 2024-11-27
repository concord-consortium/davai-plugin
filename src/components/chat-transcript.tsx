import React, { useRef, useEffect } from "react";
import { observer } from "mobx-react-lite";
import Markdown from "react-markdown";
import { DEBUG_SPEAKER } from "../constants";
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
      chatTranscriptContainer.scrollTo({top: chatTranscriptContainer.scrollHeight, behavior: "smooth"});
    }
  }, [chatTranscript.messages]);

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
          const { speaker, content, timestamp } = message;
          if (speaker === DEBUG_SPEAKER && !showDebugLog) {
            return null;
          }
          const speakerClass = speaker === DEBUG_SPEAKER ? "debug" : speaker.toLowerCase();
          return (
            <section
              aria-label={`${speaker} at ${timestamp}`}
              className={`chat-transcript__message ${speakerClass}`}
              data-testid="chat-message"
              key={`${timestamp}-${speaker}`}
              role="listitem"
            >
              <h3 aria-label="speaker" data-testid="chat-message-speaker">
                {speaker}
              </h3>
              <div aria-label="message" className={`chat-message-content ${speakerClass}`} data-testid="chat-message-content">
                <Markdown>{content}</Markdown>
              </div>
            </section>
          );
        })}
      </section>
    </section>
  );
});
