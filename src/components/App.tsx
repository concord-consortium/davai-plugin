import React, { useCallback, useEffect, useRef } from "react";
import * as Tone from "tone";
import { observer } from "mobx-react-lite";
import removeMarkdown from "remove-markdown";
import { addComponentListener, addDataContextChangeListener, addDataContextsListListener, ClientNotification,
  codapInterface, getListOfDataContexts, initializePlugin, selectSelf } from "@concord-consortium/codap-plugin-api";
import { useAppConfigContext } from "../contexts/app-config-context";
import { useRootStore } from "../contexts/root-store-context";
import { useAriaLive } from "../contexts/aria-live-context";
import { useShortcutsService } from "../contexts/shortcuts-service-context";
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
const kVersion = process.env.DAVAI_VERSION || "local-build";

export const App = observer(() => {
  const appConfig = useAppConfigContext();
  const shortcutsService = useShortcutsService();
  const { ariaLiveText, setAriaLiveText } = useAriaLive();
  const { assistantStore, sonificationStore } = useRootStore();
  const { playProcessingTone } = appConfig;
  const dimensions = { width: appConfig.dimensions.width, height: appConfig.dimensions.height };
  const subscribedDataCtxsRef = useRef<string[]>([]);
  const transcriptStore = assistantStore.transcriptStore;

  const handleDataContextChangeNotice = useCallback(async (notification: ClientNotification) => {
    if (notificationsToIgnore.includes(notification.values.operation)) return;
    // resource is in the form of "dataContextChangeNotice[<dataContextName>]";
    // the dataContext name isn't otherwise available in the notification object
    const dataCtxName = notification.resource.replace("dataContextChangeNotice[", "").replace("]", "");
    const selectedGraph = sonificationStore.selectedGraph;
    if (dataCtxName === selectedGraph?.dataContext) {
      // update the graph items
      sonificationStore.setGraphItems();
    }
    assistantStore.updateDataContexts();
    assistantStore.updateGraphs();
  }, [assistantStore, sonificationStore]);

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
      assistantStore.updateDataContexts();
      assistantStore.updateGraphs();
    }
  }, [assistantStore, handleDataContextChangeNotice]);

  const handleComponentChangeNotice = useCallback(async (notification: ClientNotification) => {
    if (notification.values.type === "graph") {
      await sonificationStore.setGraphs();

      // If this is a create, attribute change, or title change operation and the graph is sonifiable, automatically set it as selected.
      const autoSelectOperations = ["attributeChange", "create", "titleChange"];
      if (autoSelectOperations.includes(notification.values.operation)) {
        try {
          const graphs = await getGraphDetails();
          const graph = graphs.find((g: ICODAPGraph) => g.id === notification.values.id);
          if (graph && isGraphSonifiable(graph)) {
            sonificationStore.setSelectedGraphID(graph.id);
          }
        } catch (error) {
          console.error("Failed to fetch graph details for auto-selection:", error);
        }
      }
      assistantStore.updateGraphs();
    }
  }, [assistantStore, sonificationStore]);

  const handleInitializeAssistant = useCallback(() => {
    assistantStore.initializeAssistant(appConfig.llmId);
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
    shortcutsService.setFocusOurIFrameFunc(() => {
      selectSelf();
    });

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
