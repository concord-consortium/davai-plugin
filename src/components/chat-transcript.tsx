import React, { useRef, useEffect, useCallback } from "react";
import { observer } from "mobx-react-lite";
import { ChatTranscriptMessage } from "./chat-transcript-message";
import { ChatTranscript, ChatMessage } from "../types";
import { LoadingMessage } from "./loading-message";
import { useAppConfigContext } from "../contexts/app-config-context";
import { useShortcutsService } from "../contexts/shortcuts-service-context";
import { useAriaLive } from "../contexts/aria-live-context";
import { useSpeechService } from "../contexts/speech-service-context";
import {
  buildTranscriptCsv,
  buildTranscriptZip,
  copyTextToClipboard,
  downloadBlob,
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
  const speechService = useSpeechService();
  const replayHiddenCharToggleRef = useRef(true);

  // Track the currently-streaming message by its flag, not by position: the first
  // streamed chunk also appends a DEBUG "Begin response time" row right after it, so the
  // streaming message is usually not last. Driving autoscroll off its growing length
  // keeps the transcript scrolled to the newest text as chunks arrive.
  const streamingMessage = chatTranscript.messages.find((m: any) => m.isStreaming);
  const streamingLen = streamingMessage ? streamingMessage.messageContent.content.length : 0;

  useEffect(() => {
    // Autoscroll to the top of the latest message in the transcript.
    const chatTranscriptContainer = chatTranscriptRef.current;
    if (chatTranscriptContainer) {
      const lastTranscriptMessage = chatTranscriptContainer.querySelector(".chat-transcript__message:last-of-type");
      lastTranscriptMessage?.scrollIntoView({behavior: "smooth", block: "nearest"});
    }
  }, [chatTranscript.messages.length, isLoading, streamingLen]);

  const handleCaptureTranscript = useCallback(async () => {
    const { csv, images } = buildTranscriptCsv(chatTranscript.messages);

    // The clipboard always gets the readable CSV (with images/ references).
    const copied = await copyTextToClipboard(csv).then(() => true, () => false);

    // Download a zip (CSV + extracted images) when images are present, else a plain CSV.
    if (images.length > 0) {
      const zipBytes = buildTranscriptZip({ csv, images });
      downloadBlob(
        getTranscriptFilename(appConfig.llmId, new Date(), "zip"),
        new Blob([zipBytes], { type: "application/zip" })
      );
    } else {
      downloadBlob(
        getTranscriptFilename(appConfig.llmId, new Date(), "csv"),
        new Blob([csv], { type: "text/csv;charset=utf-8" })
      );
    }

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
      speechService.stopSpeech();
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
  }, [chatTranscript.messages, setAriaLiveText, shortcutsService, speechService]);

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
