import React, { useCallback, useEffect, useRef } from "react";
import * as Tone from "tone";
import { observer } from "mobx-react-lite";
import { addComponentListener, addDataContextChangeListener, addDataContextsListListener, ClientNotification,
  codapInterface, getListOfDataContexts, initializePlugin, selectSelf } from "@concord-consortium/codap-plugin-api";
import { useAppConfigContext } from "../contexts/app-config-context";
import { useRootStore } from "../contexts/root-store-context";
import { useAriaLive } from "../contexts/aria-live-context";
import { useShortcutsService } from "../contexts/shortcuts-service-context";
import { useSpeechService } from "../contexts/speech-service-context";
import { ChatInputComponent } from "./chat-input";
import { ChatTranscriptComponent } from "./chat-transcript";
import { DAVAI_SPEAKER, LOADING_NOTE, USER_SPEAKER, WEBGPU_UNAVAILABLE_MESSAGE, notificationsToIgnore } from "../constants";
import { UserOptions } from "./user-options";
import { GraphSonification } from "./graph-sonification";
import { playSound } from "../utils/utils";
import { getGraphDetails } from "../utils/codap-api-utils";
import { isGraphSonifiable } from "../utils/graph-sonification-utils";
import { ICODAPGraph } from "../types";
import { GraphSonificationScheduler } from "../models/graph-sonification-scheduler";
import { SpeakingIndicator } from "./speaking-indicator";
import { StreamingAnnouncer } from "./streaming-announcer";
import { forSpeechMultiline } from "../utils/speech-text";
import { localLlmService } from "../utils/local-llm/local-llm-service";
import { findEntryByLlmId } from "../utils/llm-effort";

import "./App.scss";

const kPluginName = "DAVAI";
const kVersion = process.env.DAVAI_VERSION || "local-build";

export const App = observer(() => {
  const appConfig = useAppConfigContext();
  const shortcutsService = useShortcutsService();
  const speechService = useSpeechService();
  const { ariaLiveText, setAriaLiveText } = useAriaLive();
  const { assistantStore, sonificationStore, transportManager } = useRootStore();
  const { playProcessingTone } = appConfig;
  const dimensions = { width: appConfig.dimensions.width, height: appConfig.dimensions.height };
  const subscribedDataCtxsRef = useRef<string[]>([]);
  const transcriptStore = assistantStore.transcriptStore;

  const handleDataContextChangeNotice = useCallback(async (notification: ClientNotification) => {
    // resource is in the form of "dataContextChangeNotice[<dataContextName>]";
    // the dataContext name isn't otherwise available in the notification object
    const dataCtxName = notification.resource.replace("dataContextChangeNotice[", "").replace("]", "");

    // Handle selection changes — fetch updated selection and reset transport if playing
    if (notification.values.operation === "selectCases") {
      if (dataCtxName === sonificationStore.selectedGraph?.dataContext) {
        if (transportManager.isPlaying || transportManager.isPaused) {
          transportManager.reset();
        }
        await sonificationStore.fetchSelection();
      }
      return;
    }

    if (notificationsToIgnore.includes(notification.values.operation)) return;
    const selectedGraph = sonificationStore.selectedGraph;
    if (dataCtxName === selectedGraph?.dataContext) {
      // update the graph items
      sonificationStore.setGraphItems();
    }
    assistantStore.updateDataContexts();
    assistantStore.updateGraphs();
  }, [assistantStore, sonificationStore, transportManager]);

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
    // When the plugin runs outside CODAP (top-level window — e.g. a direct localhost or
    // deployed-URL launch), there is no parent frame to answer CODAP API messages: every
    // request bounces off our own window and surfaces as timeouts and uncaught errors (a
    // wall of red in the webpack dev overlay). Skip all CODAP wiring in that case — chat
    // and the options panels still work.
    if (window.parent === window) return;

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

      // Configure the transport manager so it plays sonifications of the graphs
      const sonificationScheduler = new GraphSonificationScheduler(
        sonificationStore,
        appConfig,
      );
      transportManager.setTransportEventScheduler(sonificationScheduler);
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

    // Drive the local in-browser engine's lifecycle off the same LLM-selection change:
    // load it when a Local model is selected, and unload it (freeing GPU/WASM memory)
    // when switching away to a server-backed model.
    const entry = findEntryByLlmId(appConfig.llmList as any, appConfig.llmId);
    if (entry?.provider === "Local") {
      if (!localLlmService.isWebGPUAvailable()) {
        transcriptStore.addMessage(DAVAI_SPEAKER, {
          content: WEBGPU_UNAVAILABLE_MESSAGE,
          kind: "announcement",
        });
        return;
      }
      const sizeNote = entry.id.includes("1.7B") ? "about 1.1 GB" : "about 2.3 GB";
      transcriptStore.addMessage(DAVAI_SPEAKER, {
        content: `Model download started for ${entry.id}. The first download is ${sizeNote} and may take several minutes; afterward the model is cached in the browser.`,
        kind: "announcement",
      });
      localLlmService.loadEngine(entry.id).catch((err) => {
        transcriptStore.addMessage(DAVAI_SPEAKER, {
          content: `Sorry, the local model failed to load: ${err instanceof Error ? err.message : String(err)}`,
          kind: "announcement",
        });
      });
    } else {
      // Fire-and-forget: surface an unexpected unload rejection instead of an unhandled promise.
      localLlmService.unload().catch(console.error);
    }
  // appConfig.llmList and transcriptStore are intentionally omitted: llmList only changes
  // in lockstep with llmId in this codebase, and transcriptStore is a stable reference off
  // the root store — re-running this effect for either would re-trigger engine load/unload.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appConfig.llmId, handleInitializeAssistant]);

  useEffect(() => {
    // Announce coarse load milestones (25% steps) and readiness through the transcript so
    // the aria-live path reads them; per-percent updates would spam the screen reader.
    let lastMilestone = 0;
    // Track which model the milestone counter belongs to. Switching models restarts progress
    // at 0 for the new model, but a stale lastMilestone (e.g. 75 from the previous model) would
    // otherwise suppress the new model's 25/50/75 announcements. Reset when the model changes.
    let milestoneModelId: string | undefined;
    // Whether the one-time "download started" progress announcement has fired for the current
    // model's load. The first 25% milestone can take minutes on a slow connection, so this gives
    // feedback within seconds of the very first progress tick instead. Reset alongside the
    // milestone tracker (same per-modelId reset above) so a second load announces again.
    let announcedFirstProgress = false;
    const off = localLlmService.onLoadStateChange((s) => {
      if (s.status === "loading" && typeof s.progress === "number") {
        if (s.modelId !== milestoneModelId) {
          milestoneModelId = s.modelId;
          lastMilestone = 0;
          announcedFirstProgress = false;
        }
        if (!announcedFirstProgress && s.progress > 0) {
          announcedFirstProgress = true;
          transcriptStore.addMessage(DAVAI_SPEAKER, {
            content: "Downloading the local model — progress will be announced at 25% steps.",
            kind: "announcement",
          });
        }
        const milestone = Math.floor(s.progress * 4) * 25;
        if (milestone > lastMilestone && milestone < 100) {
          lastMilestone = milestone;
          transcriptStore.addMessage(DAVAI_SPEAKER, { content: `Model loading: ${milestone}% complete.`, kind: "announcement" });
        }
      } else if (s.status === "ready") {
        lastMilestone = 0;
        milestoneModelId = undefined;
        announcedFirstProgress = false;
        transcriptStore.addMessage(DAVAI_SPEAKER, { content: "The local model is ready.", kind: "announcement" });
      }
    });
    return off;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const { messages } = transcriptStore;
    if (transcriptStore.messages.length > 0) {
      const lastMessage = messages[messages.length - 1];
      if (lastMessage.speaker === DAVAI_SPEAKER && !lastMessage.isStreaming) {
        // Strip markdown and voice list/table structure (bullets -> "bullet", tables
        // linearized) for the spoken/announced text — same handling as streamed chunks.
        setAriaLiveText(forSpeechMultiline(lastMessage.messageContent.content));
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
    // A new question interrupts the previous answer's still-playing audio. (The input is
    // disabled while a response is in flight, so this only stops a finished turn's
    // lingering speech, never an in-progress one.) resumeSpeech clears any lingering
    // Escape/Stop suppression so this turn's "Processing" message and reply are read.
    speechService.stopSpeech();
    speechService.resumeSpeech();
    transcriptStore.addMessage(USER_SPEAKER, {content: messageText});

    if (appConfig.isAssistantMocked) {
      assistantStore.handleMessageSubmitMockAssistant();
    } else if (appConfig.isLocalLlm) {
      await assistantStore.handleMessageSubmitLocalLlm(messageText);
    } else {
      assistantStore.setStreamEnabled(appConfig.streamResponses);
      assistantStore.setEffort(appConfig.effort);
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
        <SpeakingIndicator isProcessing={assistantStore.showLoadingIndicator} />
      </header>
      <ChatTranscriptComponent
        chatTranscript={transcriptStore}
        isLoading={assistantStore.showLoadingIndicator}
      />
      <StreamingAnnouncer transcript={transcriptStore} />
      <ChatInputComponent
        disabled={(!assistantStore.threadId && !appConfig.isAssistantMocked) || assistantStore.isResponding}
        isLoading={assistantStore.isResponding}
        onCancel={handleCancel}
        onSubmit={handleChatInputSubmit}
      />
      <GraphSonification />
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
