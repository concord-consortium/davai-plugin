import React, { useCallback, useEffect, useRef } from "react";
import * as Tone from "tone";
import { observer } from "mobx-react-lite";
import removeMarkdown from "remove-markdown";
import { addComponentListener, addDataContextChangeListener, addDataContextsListListener, ClientNotification,
  codapInterface, getDataContext, getListOfDataContexts, initializePlugin, selectSelf } from "@concord-consortium/codap-plugin-api";
import { useAppConfigContext } from "../hooks/use-app-config-context";
import { useRootStore } from "../hooks/use-root-store";
import { useAriaLive } from "../contexts/aria-live-context";
import { useOptions } from "../hooks/use-options";
import { ChatInputComponent } from "./chat-input";
import { ChatTranscriptComponent } from "./chat-transcript";
import { DAVAI_SPEAKER, DEBUG_SPEAKER, LOADING_NOTE, USER_SPEAKER, notificationsToIgnore } from "../constants";
import { UserOptions } from "./user-options";
import { formatJsonMessage, playSound } from "../utils/utils";
import { GraphSonification } from "./graph-sonification";
import { nanoid } from "nanoid";

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
  const threadId = useRef(nanoid());

  const sendInitialContext = useCallback(async () => {
    try {
      const dataContexts = await getListOfDataContexts();
      const contextMessage = {
        role: "user",
        content: `This is a system message containing information about the CODAP document. Data contexts: \n${JSON.stringify(dataContexts.values, null, 2)}`
      };

      const response = await fetch("http://localhost:5000/api/message", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          assistantId: appConfig.assistantId,
          message: contextMessage.content,
          threadId: threadId.current
        })
      });
  
      if (!response.ok) {
        throw new Error(`Server error: ${response.status}`);
      }
    } catch (error) {
      console.error("Error sending initial context:", error);
    }
  }, [appConfig.assistantId]);

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

  const handleComponentChangeNotice = useCallback((notification: ClientNotification) => {
    if (notification.values.type === "graph") {
      sonificationStore.setGraphs();
    }
  }, [sonificationStore]);

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
    };

    init();
    sonificationStore.setGraphs();
    selectSelf();

  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // assistantStore.initializeAssistant();
    // Call sendInitialContext when the component mounts or assistantId changes
    sendInitialContext();
    assistantStoreRef.current = assistantStore;
  }, [assistantStore, appConfig.assistantId, sendInitialContext]);

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
      // assistantStore.assistant.setShowLoadingIndicator(true);
      const response = await fetch("http://localhost:5000/api/message", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          assistantId: appConfig.assistantId,
          message: messageText,
          threadId: threadId.current
        })
      });

      if (!response.ok) {
        throw new Error(`Server error: ${response.status}`);
      }

      const data = await response.json();

      // If the response is of type CODAP request, we need to make the request via the CODAP API, then pass
      // the response back to the server to be sent to the LLM.
      if (data.type && data.type === "CODAP_REQUEST") {
        try {
          const codapRequest = data.request;
          const codapResponse = await codapInterface.sendRequest(codapRequest);

          const finalResponse = await fetch("http://localhost:5000/api/message", {
            method: "POST",
            headers: {
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              assistantId: appConfig.assistantId,
              message: {
                role: "tool",
                tool_call_id: data.tool_call_id,
                content: JSON.stringify({
                  status: "success",
                  request: codapRequest.request,
                  response: codapResponse
                })
              },
              threadId: threadId.current,
              isToolResponse: true
            })
          });

          if (!finalResponse.ok) {
            throw new Error(`Server error: ${finalResponse.status}`);
          }

          const finalData = await finalResponse.json();
          assistantStore.addDavaiMsg(finalData.response);
        } catch (error: any) {
          console.error("Error handling CODAP request:", error);

          const errorResponse = await fetch("http://localhost:5000/api/message", {
            method: "POST",
            headers: {
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              assistantId: appConfig.assistantId,
              message: {
                role: "tool",
                tool_call_id: data.tool_call_id,
                content: JSON.stringify({
                  status: "error",
                  error: error.message
                })
              },
              threadId: threadId.current,
              isToolResponse: true
            })
          });
          console.error("Error sending initial context:", errorResponse);
        }
      } else {
        // If the response is a regular message, we just add it to the transcript as before.
        assistantStore.addDavaiMsg(data.response);
      }
      // assistantStore.addDavaiMsg(data.response);
      // assistantStore.assistant.setShowLoadingIndicator(false);
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
        disabled={assistantStore.showLoadingIndicator}
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
