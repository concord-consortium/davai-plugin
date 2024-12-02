import React, { useEffect, useState } from "react";
import { observer } from "mobx-react-lite";
import { initializePlugin, selectSelf } from "@concord-consortium/codap-plugin-api";
import { assistantStore } from "../models/assistant-model";
import { transcriptStore } from "../models/chat-transcript-model";
import { ChatInputComponent } from "./chat-input";
import { ChatTranscriptComponent } from "./chat-transcript";
import { ReadAloudMenu } from "./readaloud-menu";
import { KeyboardShortcutControls } from "./keyboard-shortcut-controls";
import { USER_SPEAKER } from "../constants";

import "./App.scss";

const kPluginName = "DAVAI";
const kVersion = "0.0.1";
const kInitialDimensions = {
  width: 380,
  height: 680
};

export const App = observer(() => {
  const [readAloudEnabled, setReadAloudEnabled] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const isShortcutEnabled = JSON.parse(localStorage.getItem("keyboardShortcutEnabled") || "true");
  const [keyboardShortcutEnabled, setKeyboardShortcutEnabled] = useState(isShortcutEnabled);
  const shortcutKeys = localStorage.getItem("keyboardShortcutKeys") || "ctrl+?";
  const [keyboardShortcutKeys, setKeyboardShortcutKeys] = useState(shortcutKeys);
  const url = new URL(window.location.href);
  const params = new URLSearchParams(url.search);
  const hasDebugParams = params.has("debug");
  const [showDebugLog, setShowDebugLog] = useState(hasDebugParams);

  useEffect(() => {
    initializePlugin({pluginName: kPluginName, version: kVersion, dimensions: kInitialDimensions});
    selectSelf();
    assistantStore.initialize();
  }, []);

  const handleFocusShortcut = () => {
    selectSelf();
  };

  const handleToggleShortcut = () => {
    localStorage.setItem("keyboardShortcutEnabled", JSON.stringify(!keyboardShortcutEnabled));
    setKeyboardShortcutEnabled(!keyboardShortcutEnabled);
  };

  const handleCustomizeShortcut = (shortcut: string) => {
    localStorage.setItem("keyboardShortcutKeys", shortcut);
    setKeyboardShortcutKeys(shortcut);
  };

  const handleSetReadAloudEnabled = () => {
    setReadAloudEnabled(!readAloudEnabled);
  };

  const handleSetPlaybackSpeed = (speed: number) => {
    setPlaybackSpeed(speed);
  };

  if (!assistantStore.assistant) {
    return <div>Loading...</div>;
  }

  const handleChatInputSubmit = async (messageText: string) => {
    transcriptStore.addMessage(USER_SPEAKER, {content: messageText});
    assistantStore.handleMessageSubmit(messageText);
  };

  return (
    <div className="App">
      <header>
        <h1>
          <abbr title="Data Analysis through Voice and Artificial Intelligence">DAVAI</abbr>
          <span>(Data Analysis through Voice and Artificial Intelligence)</span>
        </h1>
      </header>
      <ChatTranscriptComponent
        chatTranscript={transcriptStore}
        showDebugLog={showDebugLog}
      />
      {hasDebugParams &&
        <div className="show-debug-controls">
          <label htmlFor="debug-log-toggle">
            Show Debug Log:
          </label>
          <input
            type="checkbox"
            id="debug-log-toggle"
            name="ShowDebugLog"
            aria-checked={showDebugLog}
            checked={showDebugLog}
            onChange={() => setShowDebugLog(!showDebugLog)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                setShowDebugLog(!showDebugLog);
              }
            }}
          />
        </div>
      }
      <ChatInputComponent
        keyboardShortcutEnabled={keyboardShortcutEnabled}
        shortcutKeys={keyboardShortcutKeys}
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
});
