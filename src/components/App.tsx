import React, { useEffect, useState } from "react";
import { initializePlugin, selectSelf } from "@concord-consortium/codap-plugin-api";
// import { ReadAloudMenu } from "./readaloud-menu";
import { ChatInputComponent } from "./chat-input";
import { ChatTranscriptComponent } from "./chat-transcript";
import { ChatTranscript, ChatMessage } from "../types";
import { timeStamp } from "../utils";
import { ReadAloudMenu } from "./readaloud-menu";
import { KeyboardShortcutControls } from "./keyboard-shortcut-controls";

import "./App.scss";

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

export const App = () => {
  const greeting = "Hello! I'm DAVAI, your Data Analysis through Voice and Artificial Intelligence partner.";
  const [chatTranscript, setChatTranscript] = useState<ChatTranscript>({messages: [{speaker: "DAVAI", content: greeting, timestamp: timeStamp()}]});
  const [readAloudEnabled, setReadAloudEnabled] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [keyboardShortcutEnabled, setKeyboardShortcutEnabled] = useState(true);
  const [keyboardShortcutKeys, setKeyboardShortcutKeys] = useState("Ctrl+Command+A");

  useEffect(() => {
    initializePlugin({pluginName: kPluginName, version: kVersion, dimensions: kInitialDimensions});
    selectSelf();
  }, []);

  const handleFocusShortcut = () => {
    selectSelf();
  };

  const handleToggleShortcut = () => {
    setKeyboardShortcutEnabled(!keyboardShortcutEnabled);
  };

  const handleCustomizeShortcut = (shortcut: string) => {
    console.log("2 Customizing shortcut to", shortcut);
    setKeyboardShortcutKeys(shortcut);
  };

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
    <div className="App">
      <header>
        <h1>
          <abbr title="Data Analysis through Voice and Artificial Intelligence">DAVAI</abbr>
          <span>(Data Analysis through Voice and Artificial Intelligence)</span>
        </h1>
      </header>
      <ChatTranscriptComponent chatTranscript={chatTranscript} />
      <ChatInputComponent
        keyboardShortcutEnabled={keyboardShortcutEnabled}
        onSubmit={handleChatInputSubmit}
        onKeyboardShortcut={handleFocusShortcut}
      />
      <ReadAloudMenu
        enabled={readAloudEnabled}
        onToggle={handleSetReadAloudEnabled}
        playbackSpeed={playbackSpeed}
        onPlaybackSpeedSelect={handleSetPlaybackSpeed}
      />
      <hr />
      <h2>Options</h2>
      <KeyboardShortcutControls
        shortcutEnabled={keyboardShortcutEnabled}
        shortcutKeys={keyboardShortcutKeys}
        onCustomizeShortcut={handleCustomizeShortcut}
        onToggleShortcut={handleToggleShortcut}
      />
    </div>
  );
};
