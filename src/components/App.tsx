import React, { useCallback, useEffect, useRef } from "react";
import * as Tone from "tone";
import { observer } from "mobx-react-lite";
import removeMarkdown from "remove-markdown";
import { addComponentListener, addDataContextChangeListener, addDataContextsListListener, ClientNotification,
  codapInterface, getListOfDataContexts, initializePlugin, selectSelf } from "@concord-consortium/codap-plugin-api";
import { useAppConfigContext } from "../hooks/use-app-config-context";
import { useRootStore } from "../hooks/use-root-store";
import { useAriaLive } from "../contexts/aria-live-context";
import { useOptions } from "../hooks/use-options";
import { ChatInputComponent } from "./chat-input";
import { ChatTranscriptComponent } from "./chat-transcript";
import { DAVAI_SPEAKER, LOADING_NOTE, USER_SPEAKER, notificationsToIgnore } from "../constants";
import { UserOptions } from "./user-options";
import { GraphSonification } from "./graph-sonification";
import { playSound } from "../utils/utils";
import { getGraphDetails } from "../utils/codap-api-utils";
import { isGraphSonifiable } from "../utils/graph-sonification-utils";
import { ICODAPGraph } from "../types";

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
  const newlyCreatedGraphRef = useRef<number | null>(null);

  const handleDataContextChangeNotice = useCallback(async (notification: ClientNotification) => {
    if (notificationsToIgnore.includes(notification.values.operation)) return;
    // resource is in the form of "dataContextChangeNotice[<dataContextName>]";
    // the dataContext name isn't otherwise available in the notification object
    const dataCtxName = notification.resource.replace("dataContextChangeNotice[", "").replace("]", "");
    const selectedGraph = sonificationStoreRef.current.selectedGraph;
    if (dataCtxName === selectedGraph?.dataContext) {
      // update the graph items
      sonificationStoreRef.current.setGraphItems();
    }
    assistantStoreRef.current.updateDataContexts();
    assistantStoreRef.current.updateGraphs();
  }, []);

  // documentation of the documentChangeNotice object here:
  // https://github.com/concord-consortium/codap/wiki/CODAP-Data-Interactive-Plugin-API#documentchangenotice
  const handleDocumentChangeNotice = useCallback(async (notification: ClientNotification) => {
    if (notification.values.operation === "dataContextCountChanged") { // ignore the other notifications -- they are not useful for our purposes
      const ctxNames: string[] = (await getListOfDataContexts()).values.map((ctx: Record<string, any>) => ctx.name);
      const newCtxs = ctxNames.filter((ctx: string) => !subscribedDataCtxsRef.current.includes(ctx));
      if (newCtxs.length > 0) {
        // if we have a new data context, we need to add a listener for it
        newCtxs.forEach((newCtx) => {
          addDataContextChangeListener(newCtx, handleDataContextChangeNotice);
        });
      }
      subscribedDataCtxsRef.current = ctxNames;
      assistantStoreRef.current.updateDataContexts();
      assistantStoreRef.current.updateGraphs();
    }
  }, [handleDataContextChangeNotice]);

  const handleComponentChangeNotice = useCallback(async (notification: ClientNotification) => {
    if (notification.values.type === "graph") {
      const prevGraphIDs = sonificationStore.allGraphs.map(g => g.id);
      await sonificationStore.setGraphs();

      const newGraphIDs = sonificationStore.allGraphs.map(g => g.id);

      if (notification.values.operation === "create") {
        const newGraphID = newGraphIDs.find(id => !prevGraphIDs.includes(id));
        if (newGraphID !== undefined) {
          newlyCreatedGraphRef.current = newGraphID;
        }
      }

      // If this is an attribute change on a newly-added graph, and the graph is sonifiable, automatically set it as selected.
      if (notification.values.operation === "attributeChange" && newlyCreatedGraphRef.current !== null) {
        try {
          const graphs = await getGraphDetails();
          const graph = graphs.find((g: ICODAPGraph) => g.id === notification.values.id);
          if (graph && isGraphSonifiable(graph) && graph.id === newlyCreatedGraphRef.current) {
            sonificationStoreRef.current.setSelectedGraphID(graph.id);
            newlyCreatedGraphRef.current = null;
          }
        } catch (error) {
          console.error("Failed to fetch graph details for auto-selection:", error);
        }
      }
      assistantStoreRef.current.updateGraphs();
    }
  }, [sonificationStore]);

  const handleInitializeAssistant = useCallback(() => {
    assistantStore.initializeAssistant(appConfig.llmId);
    assistantStoreRef.current = assistantStore;
  }, [appConfig.llmId, assistantStore]);


  useEffect(() => {
    const init = async () => {
      await initializePlugin({pluginName: kPluginName, version: kVersion, dimensions});
      addDataContextsListListener(handleDocumentChangeNotice);
      addComponentListener(handleComponentChangeNotice);
      // This seems to be the only way we can track notifications about graph title changes
      // since addComponentListener doesn't catch these notifications.
      codapInterface.on("notify", "*", (notification: ClientNotification) => {
        if (notification.values.operation === "titleChange" && notification.values.type === "graph") {
          handleComponentChangeNotice(notification);
        }
      });
      const dataContexts = await getListOfDataContexts();
      dataContexts.values.forEach((ctx: Record<string, any>) => {
        subscribedDataCtxsRef.current.push(ctx.name);
        addDataContextChangeListener(ctx.name, handleDataContextChangeNotice);
      });
      await sonificationStore.setGraphs();
    };

    init();
    selectSelf();

  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // Initialize the assistant on mount and when the LLM ID changes.
    handleInitializeAssistant();
  }, [appConfig.llmId, handleInitializeAssistant]);

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
      await assistantStore.handleMessageSubmit(messageText);
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
        disabled={(!assistantStore.threadId && !appConfig.isAssistantMocked) || assistantStore.showLoadingIndicator}
        isLoading={assistantStore.showLoadingIndicator}
        onCancel={handleCancel}
        onSubmit={handleChatInputSubmit}
        onKeyboardShortcut={handleFocusShortcut}
      />
      <GraphSonification
        sonificationStore={sonificationStore}
      />
      <UserOptions assistantStore={assistantStore} onInitializeAssistant={handleInitializeAssistant} />
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
