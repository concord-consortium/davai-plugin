import React, { useRef, useEffect, useCallback } from "react";
import { observer } from "mobx-react-lite";
import { ChatTranscriptMessage } from "./chat-transcript-message";
import { ChatTranscript, ChatMessage } from "../types";
import { LoadingMessage } from "./loading-message";
import { useAppConfigContext } from "../contexts/app-config-context";
import { useShortcutsService } from "../contexts/shortcuts-service-context";
import { useAriaLive } from "../contexts/aria-live-context";
import {
  copyTextToClipboard,
  downloadTextFile,
  formatTranscriptForCapture,
  getTranscriptFilename,
} from "../utils/transcript-utils";

import "./chat-transcript.scss";

interface IProps {
  chatTranscript: ChatTranscript;
  isLoading?: boolean;
}

export const ChatTranscriptComponent = observer(({chatTranscript, isLoading}: IProps) => {
  const appConfig = useAppConfigContext();
  const { showDebugLog } = appConfig;
  const shortcutsService = useShortcutsService();
  const chatTranscriptRef = useRef<HTMLDivElement>(null);
  const { setAriaLiveText } = useAriaLive();
  const replayHiddenCharToggleRef = useRef(true);

  useEffect(() => {
    // Autoscroll to the top of the latest message in the transcript.
    const chatTranscriptContainer = chatTranscriptRef.current;
    if (chatTranscriptContainer) {
      const lastMessage = chatTranscriptContainer.querySelector(".chat-transcript__message:last-of-type");
      lastMessage?.scrollIntoView({behavior: "smooth", block: "nearest"});
    }
  }, [chatTranscript.messages.length, isLoading]);

  const handleCaptureTranscript = useCallback(async () => {
    const text = formatTranscriptForCapture(chatTranscript.messages);
    const filename = getTranscriptFilename(appConfig.llmId, new Date());

    let copied = true;
    try {
      await copyTextToClipboard(text);
    } catch {
      copied = false;
    }
    downloadTextFile(filename, text);

    setAriaLiveText(copied
      ? "Transcript copied to clipboard and downloaded."
      : "Transcript downloaded. Could not copy to clipboard.");
  }, [chatTranscript, appConfig, setAriaLiveText]);

  useEffect(() => {
    return shortcutsService.registerShortcutHandler("captureTranscript", (event) => {
      event.preventDefault();
      handleCaptureTranscript();
    }, { focus: true });
  }, [shortcutsService, handleCaptureTranscript]);

  useEffect(() => {
    // A shortcut to set the last message in the live aria region
    return shortcutsService.registerShortcutHandler("replayLastDavaiMessage", (event) => {
      event.preventDefault();
      const lastDavaiMessage = chatTranscript.messages.filter(msg => msg.speaker === "DAVAI").pop();
      // We toggle an invisible character to force the screen reader to read the same message again.
      // We tried to clear the live text, wait, and set it again, but that didn't work
      replayHiddenCharToggleRef.current = !replayHiddenCharToggleRef.current;
      const suffix = replayHiddenCharToggleRef.current ? "\u200B" : "\u200C";
      if (lastDavaiMessage) {
        setAriaLiveText(`Last Message: ${lastDavaiMessage.plainTextContent}${suffix}`);
      } else {
        setAriaLiveText(`No previous message from DAVAI to replay.${suffix}`);
      }
    }, { focus: true });
  }, [chatTranscript.messages, setAriaLiveText, shortcutsService]);

  return (
    <div
      className="chat-transcript-wrapper"
      data-testid="chat-transcript"
      role="group"
      aria-labelledby="chat-transcript-heading"
    >
      <h2 id="chat-transcript-heading" className="visually-hidden">Chat Transcript</h2>
      <div className="chat-transcript__toolbar">
        <button
          type="button"
          className="capture-transcript"
          data-testid="capture-transcript-button"
          aria-label="Capture transcript"
          onClick={handleCaptureTranscript}
        >
          Capture Transcript
        </button>
      </div>
      <div ref={chatTranscriptRef} id="chat-transcript" className="chat-transcript">
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
    </div>
  );
});
