import React, { useRef, useEffect } from "react";
import { observer } from "mobx-react-lite";
import { ChatTranscriptMessage } from "./chat-transcript-message";
import { ChatTranscript, ChatMessage } from "../types";
import { LoadingMessage } from "./loading-message";
import { useAppConfigContext } from "../contexts/app-config-context";
import { useShortcutsService } from "../contexts/shortcuts-service-context";
import { useAriaLive } from "../contexts/aria-live-context";

import "./chat-transcript.scss";

interface IProps {
  chatTranscript: ChatTranscript;
  isLoading?: boolean;
}

export const ChatTranscriptComponent = observer(({chatTranscript, isLoading}: IProps) => {
  const { showDebugLog } = useAppConfigContext();
  const shortcutsService = useShortcutsService();
  const chatTranscriptRef = useRef<HTMLDivElement>(null);
  const { setAriaLiveText } = useAriaLive();

  useEffect(() => {
    // Autoscroll to the top of the latest message in the transcript.
    const chatTranscriptContainer = chatTranscriptRef.current;
    if (chatTranscriptContainer) {
      const lastMessage = chatTranscriptContainer.querySelector(".chat-transcript__message:last-of-type");
      lastMessage?.scrollIntoView({behavior: "smooth", block: "nearest"});
    }
  }, [chatTranscript.messages.length, isLoading]);

  useEffect(() => {
    // A shortcut to set the last message in the live aria region
    return shortcutsService.registerShortcutHandler("replayLastDavaiMessage", (event) => {
      event.preventDefault();
      const lastDavaiMessage = chatTranscript.messages.filter(msg => msg.speaker === "DAVAI").pop();
      // We first clear the live text to ensure the screen reader will read the
      // the message again even if it is the same as before.
      setAriaLiveText("");
      setTimeout(() => {
        if (lastDavaiMessage) {
          setAriaLiveText(lastDavaiMessage.plainTextContent);
        } else {
          setAriaLiveText("No previous message from DAVAI to replay.");
        }
      },
      10);
    }, { focus: true });
  }, [chatTranscript.messages, setAriaLiveText, shortcutsService]);

  return (
    <div ref={chatTranscriptRef} id="chat-transcript" className="chat-transcript" data-testid="chat-transcript" role="group">
      <h2 className="visually-hidden">Chat Transcript</h2>
      <div
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
        {isLoading && <LoadingMessage/>}
      </div>
    </div>
  );
});
