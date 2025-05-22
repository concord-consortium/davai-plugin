import React, { useCallback, useEffect, useRef } from "react";
import * as Tone from "tone";
import { observer } from "mobx-react-lite";
import removeMarkdown from "remove-markdown";
import { addComponentListener, addDataContextChangeListener, addDataContextsListListener, ClientNotification,
  getDataContext, getListOfDataContexts, initializePlugin, selectSelf } from "@concord-consortium/codap-plugin-api";
import { useAppConfigContext } from "../hooks/use-app-config-context";
import { useRootStore } from "../hooks/use-root-store";
import { useAriaLive } from "../contexts/aria-live-context";
import { useOptions } from "../hooks/use-options";
import { ChatInputComponent } from "./chat-input";
import { ChatTranscriptComponent } from "./chat-transcript";
import { DAVAI_SPEAKER, DEBUG_SPEAKER, LOADING_NOTE, USER_SPEAKER, notificationsToIgnore } from "../constants";
import { UserOptions } from "./user-options";
import { formatJsonMessage, getGraphDetails, playSound } from "../utils/utils";
import { GraphSonification } from "./graph-sonification";

import "./App.scss";

const kPluginName = "DAVAI";
const kVersion = "0.1.0";

export const App = observer(() => {
  const appConfig = useAppConfigContext();
  const { ariaLiveText, setAriaLiveText } = useAriaLive();
  const { assistantStore, sonificationStore } = useRootStore();
  const { playProcessingTone } = useOptions();
  const assistantStoreRef = useRef(assistantStore);
  const sonificationStoreRef = useRef(sonificationStore);
  const dimensions = { width: appConfig.dimensions.width, height: appConfig.dimensions.height };
  const subscribedDataCtxsRef = useRef<string[]>([]);
  const transcriptStore = assistantStore.transcriptStore;

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
    const selectedGraph = sonificationStoreRef.current.selectedGraph;
    if (dataCtxName === selectedGraph?.dataContext) {
      // update the graph items
      sonificationStoreRef.current.setGraphItems();
    }
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

  const fetchGraphs = useCallback(async () => {
    const graphDetails = await getGraphDetails();
    sonificationStore.setGraphs(graphDetails);
  }, [sonificationStore]);

  const handleComponentChangeNotice = useCallback((notification: ClientNotification) => {
    if (notification.values.type === "graph") {
      fetchGraphs();
    }
  }, [fetchGraphs]);

  useEffect(() => {
    const init = async () => {
      await initializePlugin({pluginName: kPluginName, version: kVersion, dimensions});
      addComponentListener(handleComponentChangeNotice);
      addDataContextsListListener(handleDocumentChangeNotice);
      const dataContexts = await getListOfDataContexts();
      dataContexts.values.forEach((ctx: Record<string, any>) => {
        subscribedDataCtxsRef.current.push(ctx.name);
        addDataContextChangeListener(ctx.name, handleDataContextChangeNotice);
      });
    };

    init();
    fetchGraphs();
    selectSelf();

  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    assistantStore.initializeAssistant();
    assistantStoreRef.current = assistantStore;
  }, [assistantStore, appConfig.assistantId]);

  useEffect(() => {
    const { messages } = transcriptStore;
    if (transcriptStore.messages.length > 0) {
      const lastMessage = messages[messages.length - 1];
      if (lastMessage.speaker === DAVAI_SPEAKER) {
        const plainTextContent = removeMarkdown(lastMessage.messageContent.content, {stripListLeaders: false, useImgAltText: true});
        setAriaLiveText(plainTextContent);
      }
    }
  }, [transcriptStore, transcriptStore.messages.length, setAriaLiveText]);

  useEffect(() => {
    if (!assistantStore.showLoadingIndicator) return;

    let interval: NodeJS.Timeout | undefined;

    if (playProcessingTone) {
      playSound(LOADING_NOTE);
      interval = setInterval(() => playSound(LOADING_NOTE), 2000);
    }

    return () => {
      if (interval) {
        clearInterval(interval);
      }
    };

  }, [assistantStore.showLoadingIndicator, playProcessingTone]);

  const handleFocusShortcut = () => {
    selectSelf();
  };

  const handleChatInputSubmit = async (messageText: string) => {
    Tone.start();
    transcriptStore.addMessage(USER_SPEAKER, {content: messageText});

    if (appConfig.isAssistantMocked) {
      assistantStore.handleMessageSubmitMockAssistant();
    } else {
      assistantStore.handleMessageSubmit(messageText);
    }
  };

  const handleCancel = () => {
    assistantStore.handleCancel();
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
        isLoading={assistantStore.showLoadingIndicator}
      />
      <ChatInputComponent
        disabled={(!assistantStore.thread && !appConfig.isAssistantMocked) || assistantStore.showLoadingIndicator}
        isLoading={assistantStore.showLoadingIndicator}
        onCancel={handleCancel}
        onSubmit={handleChatInputSubmit}
        onKeyboardShortcut={handleFocusShortcut}
      />
      <GraphSonification
        sonificationStore={sonificationStore}
      />
      <UserOptions assistantStore={assistantStore} />
      {/*
        The aria-live region is used to announce the last message from DAVAI.
        The region is updated whenever a new message is added to the transcript,
        or while the LLM is processing with a "Processing" message.
      */}
      <div
        className="visually-hidden"
        role="alert"
        aria-live="assertive"
        aria-atomic="true"
      >
        {ariaLiveText}
      </div>
    </div>
  );
});
