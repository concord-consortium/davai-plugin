import React, { useCallback, useEffect, useRef, useState } from "react";
import { observer } from "mobx-react-lite";
import { addDataContextChangeListener, addDataContextsListListener, ClientNotification, getDataContext, getListOfDataContexts, initializePlugin, selectSelf } from "@concord-consortium/codap-plugin-api";
import { useAppConfigContext } from "../hooks/use-app-config-context";
import { useAssistantStore } from "../hooks/use-assistant-store";
import { ChatInputComponent } from "./chat-input";
import { ChatTranscriptComponent } from "./chat-transcript";
import { ReadAloudMenu } from "./readaloud-menu";
import { KeyboardShortcutControls } from "./keyboard-shortcut-controls";
import { DAVAI_SPEAKER, DEBUG_SPEAKER, GREETING, USER_SPEAKER, notificationsToIgnore } from "../constants";
import { DeveloperOptionsComponent } from "./developer-options";
import { formatJsonMessage, getUrlParam } from "../utils/utils";

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
  const [playProcessingTone, setPlayProcessingTone] = useState(true);
  const isShortcutEnabled = JSON.parse(localStorage.getItem("keyboardShortcutEnabled") || "true");
  const [keyboardShortcutEnabled, setKeyboardShortcutEnabled] = useState(isShortcutEnabled);
  const shortcutKeys = localStorage.getItem("keyboardShortcutKeys") || appConfig.accessibility.keyboardShortcut;
  const [keyboardShortcutKeys, setKeyboardShortcutKeys] = useState(shortcutKeys);
  const modeUrlParam = getUrlParam("mode") || "";
  const isDevMode = modeUrlParam === "development" || appConfig.mode === "development";
  const [showDebugLog, setShowDebugLog] = useState(isDevMode);
  const assistantStoreRef = useRef(assistantStore);
  const subscribedDataCtxsRef = useRef<string[]>([]);

  const handleDataContextChangeNotice = useCallback(async (notification: ClientNotification) => {
    if (notificationsToIgnore.includes(notification.values.operation)) return;

    assistantStoreRef.current.transcriptStore.addMessage(DEBUG_SPEAKER, {
      description: "Data context change notice",
      content: formatJsonMessage(notification)
    });

    // resource is in the form of "dataContextChangeNotice[<dataContextName>]";
    // the dataContext name isn't otherwise available in the notification object
    const dataCtxName = notification.resource.replace("dataContextChangeNotice[", "").replace("]", "");
    const updatedCtxInfo = await getDataContext(dataCtxName);
    const msg = `Data context ${dataCtxName} has been updated: ${JSON.stringify(updatedCtxInfo.values)}`;
    assistantStoreRef.current.sendDataCtxChangeInfo(msg);
  }, []);

  // documentation of the documentChangeNotice object here:
  // https://github.com/concord-consortium/codap/wiki/CODAP-Data-Interactive-Plugin-API#documentchangenotice
  const handleDocumentChangeNotice = useCallback(async (notification: ClientNotification) => {
    if (notification.values.operation === "dataContextCountChanged") { // ignore the other notifications -- they are not useful for our purposes
      assistantStoreRef.current.transcriptStore.addMessage(DEBUG_SPEAKER, {
        description: "Document change notice", content: formatJsonMessage(notification)
      });
      const ctxNames = (await getListOfDataContexts()).values.map((ctx: Record<string, any>) => ctx.name);
      const wasNewCtxCreated = ctxNames.length > subscribedDataCtxsRef.current.length;
      if (wasNewCtxCreated) {
        // if we have a new data context, we need to add a listener for it
        const newCtxName = ctxNames.filter((ctx: string) => !subscribedDataCtxsRef.current.includes(ctx))[0];
        addDataContextChangeListener(newCtxName, handleDataContextChangeNotice);
        const newCtxInfo = await getDataContext(newCtxName);
        const msg = `New data context ${newCtxName} created: ${JSON.stringify(newCtxInfo)}`;
        assistantStoreRef.current.sendDataCtxChangeInfo(msg);
      } else {
        const removedCtx = subscribedDataCtxsRef.current.filter((ctx: string) => !ctxNames.includes(ctx))[0];
        const msg = `Data context ${removedCtx} has been removed`;
        assistantStoreRef.current.sendDataCtxChangeInfo(msg);
      }
      subscribedDataCtxsRef.current = ctxNames;
    }
  }, [handleDataContextChangeNotice]);

  useEffect(() => {
    const init = async () => {
      await initializePlugin({pluginName: kPluginName, version: kVersion, dimensions});
      addDataContextsListListener(handleDocumentChangeNotice);
      const dataContexts = await getListOfDataContexts();
      dataContexts.values.forEach((ctx: Record<string, any>) => {
        subscribedDataCtxsRef.current.push(ctx.name);
        addDataContextChangeListener(ctx.name, handleDataContextChangeNotice);
      });
    };
    init();
    selectSelf();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    assistantStore.initializeAssistant();
    assistantStoreRef.current = assistantStore;
  }, [assistantStore, appConfig.assistantId]);

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
    transcriptStore.addMessage(USER_SPEAKER, {content: messageText});

    if (appConfig.isAssistantMocked) {
      assistantStore.handleMessageSubmitMockAssistant();
    } else {
      assistantStore.handleMessageSubmit(messageText);
    }

  };

  const handleCreateThread = async () => {
    const confirmCreate = window.confirm("Are you sure you want to create a new thread? If you do, you will lose any existing chat history.");
    if (!confirmCreate) return;

    transcriptStore.clearTranscript();
    transcriptStore.addMessage(DAVAI_SPEAKER, {content: GREETING});

    await assistantStore.createThread();
  };

  const handleDeleteThread = async () => {
    const confirmDelete = window.confirm("Are you sure you want to delete the current thread? If you do, you will not be able to continue this chat.");
    if (!confirmDelete) return false;

    await assistantStore.deleteThread();
    return true;
  };

  const handleSelectAssistant = async (id: string) => {
    // If we switch assistants, we delete the current thread and clear the transcript.
    // First make sure the user is OK with that.
    const threadDeleted = await handleDeleteThread();
    if (!threadDeleted) return;

    if (id === "mock") {
      transcriptStore.clearTranscript();
      transcriptStore.addMessage(DAVAI_SPEAKER, {content: GREETING});
      appConfig.setMockAssistant(true);
      appConfig.setAssistantId(id);
      return;
    }

    appConfig.setMockAssistant(false);
    appConfig.setAssistantId(id);
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
        isLoading={assistantStore.isLoadingResponse}
        playProcessingTone={playProcessingTone}
        showDebugLog={showDebugLog}
      />
      {isDevMode &&
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
            role="switch"
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
        disabled={(!assistantStore.thread && !appConfig.isAssistantMocked) || assistantStore.isLoadingResponse}
        keyboardShortcutEnabled={keyboardShortcutEnabled}
        shortcutKeys={keyboardShortcutKeys}
        onSubmit={handleChatInputSubmit}
        onKeyboardShortcut={handleFocusShortcut}
      />
      <div className="processing-chime-controls">
        <label htmlFor="processing-chime-toggle">
          Play chime while DAVAI is responding:
        </label>
        <input
          className="processing-chime-toggle"
          id="processing-chime-toggle"
          type="checkbox"
          role="switch"
          checked={playProcessingTone}
          aria-label={playProcessingTone ? "Turn off processing chime" : "Turn on processing chime"}
          aria-checked={playProcessingTone}
          onChange={() => setPlayProcessingTone(!playProcessingTone)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              setPlayProcessingTone(!playProcessingTone);
            }
          }}
        />
      </div>
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
      {isDevMode &&
        <>
          <hr />
          <h2>Developer Options</h2>
          <DeveloperOptionsComponent
            assistantStore={assistantStore}
            onCreateThread={handleCreateThread}
            onDeleteThread={handleDeleteThread}
            onSelectAssistant={handleSelectAssistant}
          />
        </>
      }
    </div>
  );
});
