import React, { useEffect, useState } from "react";
import { observer } from "mobx-react-lite";
import { initializePlugin, selectSelf } from "@concord-consortium/codap-plugin-api";
import { useAppConfigContext } from "../hooks/use-app-config-context";
import { useAssistantStore } from "../hooks/use-assistant-store";
import { ChatInputComponent } from "./chat-input";
import { ChatTranscriptComponent } from "./chat-transcript";
import { ReadAloudMenu } from "./readaloud-menu";
import { KeyboardShortcutControls } from "./keyboard-shortcut-controls";
import { DAVAI_SPEAKER, GREETING, USER_SPEAKER } from "../constants";
import { DeveloperOptionsComponent } from "./developer-options";

import "./App.scss";

const kPluginName = "DAVAI";
const kVersion = "0.0.1";

export const App = observer(() => {
  const appConfig = useAppConfigContext();
  const assistantStore = useAssistantStore();
  const transcriptStore = assistantStore.transcriptStore;
  const dimensions = { width: appConfig.dimensions.width, height: appConfig.dimensions.height };
  const [readAloudEnabled, setReadAloudEnabled] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const isShortcutEnabled = JSON.parse(localStorage.getItem("keyboardShortcutEnabled") || "true");
  const [keyboardShortcutEnabled, setKeyboardShortcutEnabled] = useState(isShortcutEnabled);
  const shortcutKeys = localStorage.getItem("keyboardShortcutKeys") || appConfig.accessibility.keyboardShortcut;
  const [keyboardShortcutKeys, setKeyboardShortcutKeys] = useState(shortcutKeys);

  useEffect(() => {
    initializePlugin({pluginName: kPluginName, version: kVersion, dimensions});
    selectSelf();
    assistantStore.initialize();
  // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const handleChatInputSubmit = async (messageText: string) => {
    transcriptStore.addMessage(USER_SPEAKER, messageText);

    if (appConfig.isAssistantMocked) {
      assistantStore.handleMessageSubmitMockAssistant();
    } else {
      assistantStore.handleMessageSubmit(messageText);
    }

  };

  const handleCreateThread = async () => {
    const confirmCreate = window.confirm("Are you sure you want to create a new thread? If you do, you will not be able to continue this chat and will lose its history.");
    if (!confirmCreate) return;

    transcriptStore.clearTranscript();
    transcriptStore.addMessage(DAVAI_SPEAKER, GREETING);

    await assistantStore.createThread();
  };

  const handleDeleteThread = async () => {
    const confirmDelete = window.confirm("Are you sure you want to delete the current thread? If you do, you will not be able to continue this chat.");
    if (!confirmDelete) return false;

    await assistantStore.deleteThread();
    return true;
  };

  const handleMockAssistant = async () => {
    if (!appConfig.isAssistantMocked) {
      // If we switch to a mocked assistant, we delete the current thread and clear the transcript.
      // First make sure the user is OK with that.
      const threadDeleted = await handleDeleteThread();
      if (!threadDeleted) return;

      transcriptStore.clearTranscript();
      transcriptStore.addMessage(DAVAI_SPEAKER, GREETING);
      appConfig.toggleMockAssistant();
    } else {
      appConfig.toggleMockAssistant();
    }
  };

  if (!assistantStore.assistant) {
    return <div>Loading...</div>;
  }

  return (
    <div className="App">
      <header>
        <h1>
          <abbr title="Data Analysis through Voice and Artificial Intelligence">DAVAI</abbr>
          <span>(Data Analysis through Voice and Artificial Intelligence)</span>
        </h1>
      </header>
      <ChatTranscriptComponent chatTranscript={transcriptStore} />
      <ChatInputComponent
        disabled={!assistantStore.thread && !appConfig.isAssistantMocked}
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
      {appConfig.mode === "development" &&
        <>
          <hr />
          <h2>Developer Options</h2>
          <DeveloperOptionsComponent
            assistantStore={assistantStore}
            onCreateThread={handleCreateThread}
            onDeleteThread={handleDeleteThread}
            onMockAssistant={handleMockAssistant}
          />
        </>
      }
    </div>
  );
});
