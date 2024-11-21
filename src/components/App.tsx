import React, { useEffect, useState } from "react";
import { initializePlugin } from "@concord-consortium/codap-plugin-api";
import { ReadAloudMenu } from "./readaloud-menu";
import { ChatInputComponent } from "./chat-input";
import { ChatTranscriptComponent } from "./chat-transcript";
import { ChatTranscript, ChatMessage } from "../types";
import { timeStamp } from "../utils";

import "./App.css";

const kPluginName = "DAVAI";
const kVersion = "0.0.1";
const kInitialDimensions = {
  width: 380,
  height: 680
};

const mockAiResponse = (): ChatMessage => {
  const response = {
    content: "Sorry. I'm just a mock AI and don't really know how to respond.",
    speaker: "DAVAI",
    timestamp: timeStamp()
  };
  return response;
};

interface IAppProps {
  activeTrap: boolean;
  handleSetActiveTrap: (active: boolean) => void;
}

export const App = ({activeTrap, handleSetActiveTrap}: IAppProps) => {
  const greeting = "Hello! I'm DAVAI, your Data Analysis through Voice and Artificial Intelligence partner.";
  const [chatTranscript, setChatTranscript] = useState<ChatTranscript>({messages: [{speaker: "DAVAI", content: greeting, timestamp: timeStamp()}]});
  const [readAloudEnabled, setReadAloudEnabled] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);

  useEffect(() => {
    initializePlugin({pluginName: kPluginName, version: kVersion, dimensions: kInitialDimensions});
  }, []);

  const handleSetReadAloudEnabled = () => {
    setReadAloudEnabled(!readAloudEnabled);
  };

  const handleSetPlaybackSpeed = (speed: number) => {
    setPlaybackSpeed(speed);
  };

  const handleChatInputSubmit = (messageText: string) => {
    setChatTranscript(prevTranscript => ({
      messages: [...prevTranscript.messages, { speaker: "User", content: messageText, timestamp: timeStamp() }]
    }));
    // For now, just mock an AI response after a delay.
    setTimeout(() => {
      setChatTranscript(prevTranscript => ({
        messages: [...prevTranscript.messages, mockAiResponse()]
      }));
    }, 1000);
  };

  return (
    <div
      onFocus={() => handleSetActiveTrap(true)}
      role="main"
      className={`App ${activeTrap && "isActive"}`}
    >
      <h1>
        DAVAI
        <span>(Data Analysis through Voice and Artificial Intelligence)</span>
      </h1>
      <ChatTranscriptComponent chatTranscript={chatTranscript} />
      <ChatInputComponent onSubmit={handleChatInputSubmit} />
      <ReadAloudMenu
        enabled={readAloudEnabled}
        onToggle={handleSetReadAloudEnabled}
        playbackSpeed={playbackSpeed}
        onPlaybackSpeedSelect={handleSetPlaybackSpeed}
      />
      <button onClick={() => handleSetActiveTrap(true)}>activate focus trap</button>
      <button onClick={() => handleSetActiveTrap(false)}>exit focus trap</button>
    </div>
  );
};
