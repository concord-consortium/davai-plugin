import { types, flow, Instance, getRoot, onSnapshot } from "mobx-state-tree";
import { nanoid } from "nanoid";
import { codapInterface } from "@concord-consortium/codap-plugin-api";
import { DAVAI_SPEAKER, DEBUG_SPEAKER } from "../constants";
import { formatJsonMessage, getDataContexts, getGraphByID, isGraphSonifiable } from "../utils/utils";
import { ChatTranscriptModel } from "./chat-transcript-model";
import { IGraphAttrData, IToolCallData, IMessageResponse, ToolOutput } from "../types";
import { extractDataContexts, IExtractedDataContext } from "../utils/data-context-utils";
import { postMessage } from "../utils/llm-utils";

/**
 * AssistantModel encapsulates the AI assistant and its interactions with the user.
 * It includes properties and methods for configuring the assistant, handling chat interactions, and maintaining the assistant's
 * thread and transcript.
 *
 * @property {Object} apiConnection - The API connection object for interacting with the assistant
 * @property {Object|null} assistant - The assistant object, or `null` if not initialized.
 * @property {string[]} codapNotificationQueue - Queue of messages to be sent to the assistant. Used if CODAP generates notifications while assistant is processing a response.
 * @property {string} dataUri - The data URI of the file to be uploaded.
 * @property {boolean} isCancelling - Flag indicating whether the assistant is currently cancelling a request.
 * @property {boolean} isLoadingResponse - Flag indicating whether the assistant is currently processing a response.
 * @property {boolean} isResetting - Flag indicating whether the assistant is currently resetting the chat.
 * @property {string} llmId - The unique ID string of the LLM being used, or `null` if not initialized.
 * @property {string[]} messageQueue - Queue of messages to be sent to the assistant. Used if user sends messages while assistant is processing a response.
 * @property {boolean} showLoadingIndicator - Flag indicating whether to show a loading indicator to the user; this is decoupled from the assistant's internal loading state to allow for more control over UI elements.
 * @property {Object|null} thread - The assistant's thread used for the current chat, or `null` if no thread is active.
 * @property {ChatTranscriptModel} transcriptStore - The assistant's chat transcript store for recording and managing chat messages.
 * @property {boolean} uploadFileAfterRun - Flag indicating whether to upload a file after the assistant completes a run.
 */
export const AssistantModel = types
  .model("AssistantModel", {
    // assistant: types.maybe(types.frozen()),
    codapNotificationQueue: types.array(types.frozen<IExtractedDataContext>()),
    isCancelling: types.optional(types.boolean, false),
    isLoadingResponse: types.optional(types.boolean, false),
    isResetting: types.optional(types.boolean, false),
    messageQueue: types.array(types.string),
    showLoadingIndicator: types.optional(types.boolean, false),
    threadId: types.maybe(types.string),
    transcriptStore: ChatTranscriptModel,
  })
  .volatile(() => ({
    llmId: "mock" as string,  // Set explicitly via setLlmId
    currentMessageId: null as string | null,
  }))
  .views((self) => ({
    get isAssistantMocked() {
      const llmData = JSON.parse(self.llmId || "");
      return llmData.id === "mock";
    }
  }))
  .actions((self) => ({
    addDavaiMsg(msg: string) {
      self.transcriptStore.addMessage(DAVAI_SPEAKER, { content: msg });
    },
    addDbgMsg (description: string, content: any) {
      self.transcriptStore.addMessage(DEBUG_SPEAKER, { description, content });
    },
    setShowLoadingIndicator(show: boolean) {
      self.showLoadingIndicator = show;
    },
    setLlmId(llmId: string) {
      self.llmId = llmId;
    },
    setThreadId(threadId: string) {
      self.threadId = threadId;
    }
  }))
  .actions((self) => ({
    handleMessageSubmitMockAssistant() {
      self.setShowLoadingIndicator(true);
      // Use a brief delay to prevent duplicate timestamp-based keys.
      setTimeout(() => {
        self.addDavaiMsg("I'm just a mock assistant and can't process that request.");
        self.setShowLoadingIndicator(false);
      }, 2000);
    },
    setTranscriptStore(transcriptStore: any) {
      self.transcriptStore = transcriptStore;
    }
  }))
  .actions((self) => ({
    clearCODAPNotificationQueue() {
      self.codapNotificationQueue.clear();
    },
    clearUserMessageQueue() {
      self.messageQueue.clear();
    },
    deDupeCODAPNotificationQueue(msg: IExtractedDataContext) {
      // If any existing messages in the queue have the same type and ID values as `msg`, we remove them
      // from the queue since they are no longer up to date and will be wasting valuable space.
      // Note that `codapData` should have only one key which will be a prefix string like the ones defined
      // in `DATA_CONTEXT_MESSAGES`, and the value will be the data context object.
      const msgKey = Object.keys(msg.codapData)[0];
      const msgValue = msg.codapData[msgKey];
      self.codapNotificationQueue.replace(
        self.codapNotificationQueue.filter(queued => {
          const queuedKey = Object.keys(queued.codapData)[0];
          const queuedValue = queued.codapData[queuedKey];

          return !(queued.type === msg.type && queuedValue.id === msgValue.id);
        })
      );
    }
  }))
  .actions((self) => ({
    addMessageToCODAPNotificationQueue(msg: IExtractedDataContext | null) {
      if (!msg) return;

      if (self.codapNotificationQueue.length > 0) {
        self.deDupeCODAPNotificationQueue(msg);
      }
      self.codapNotificationQueue.push(msg);
    },
  }))
  .actions((self) => {
    const initializeAssistant = flow(function* (llmId: string) {
      try {
        self.setLlmId(llmId);
        self.setThreadId(nanoid());
        self.addDbgMsg("Assistant initialized", `Assistant ID: ${llmId}, Thread ID: ${self.threadId}`);
        yield fetchAndSendDataContexts();
      } catch (err) {
        console.error("Failed to initialize assistant:", err);
        self.addDbgMsg("Failed to initialize assistant", formatJsonMessage(err));
      }
    });

    const fetchAndSendDataContexts = flow(function* () {
      try {
        const contexts = yield getDataContexts();
        self.addDbgMsg("Data contexts information", formatJsonMessage(contexts));
        processAndSendCODAPDocumentInfo(`Data contexts: ${JSON.stringify(contexts)}`);
      } catch (err) {
        console.error("Failed to get data contexts:", err);
        self.addDbgMsg("Failed to get data contexts", formatJsonMessage(err));
      }
    });

    const sendDataCtxChangeInfo = flow(function* (msg: string) {
      const dataContextMsg = extractDataContexts(msg);
      if (!dataContextMsg) {
        self.addDbgMsg("No data contexts extracted from message", msg);
        return;
      }

      try {
        if (self.isLoadingResponse || self.isCancelling || self.isResetting) {
          self.addMessageToCODAPNotificationQueue(dataContextMsg);
        } else {
          yield processAndSendCODAPDocumentInfo(msg);
        }
      } catch (err) {
        console.error("Failed to send data context info to LLM:", err);
        self.addDbgMsg("Failed to send data context info to the LLM", formatJsonMessage(err));
      }
    });

    const sendCODAPDataToLlm = flow(function* (codapData: Record<string, any>) {
      if (self.isAssistantMocked) return;

      const requestBody = {
        llmId: self.llmId,
        threadId: self.threadId,
        codapData
      };

      const dataContextResponse = yield postMessage(requestBody, "message");
      if (!dataContextResponse.ok) {
        throw new Error(`Failed to send system message: ${dataContextResponse.statusText}`);
      }
      const data = yield dataContextResponse.json();
      self.addDbgMsg("CODAP document info received by LLM", formatJsonMessage(data));
    });

    const processAndSendCODAPDocumentInfo = flow(function* (msg) {
      if (self.isAssistantMocked) return;

      try {
        const dataContextMsg = extractDataContexts(msg);
        self.addDbgMsg("Sending CODAP document info to LLM", dataContextMsg ? formatJsonMessage(dataContextMsg) : msg);
        if (!self.threadId) {
          console.warn("Thread ID is not set, queuing CODAP document info message:", msg);
          self.addMessageToCODAPNotificationQueue(dataContextMsg);
        } else {
          if (dataContextMsg) {
            self.isLoadingResponse = true;
            yield sendCODAPDataToLlm(dataContextMsg.codapData);
            self.isLoadingResponse = false;
          } else {
            self.addDbgMsg("Could not extract data contexts from message", msg);
          }
        }
      } catch (err) {
        console.error("Failed to send system message:", err);
        self.addDbgMsg("Failed to send CODAP document information to LLM", formatJsonMessage(err));
      }
    });

    const processToolCall = flow(function* (data: IToolCallData) {
      try {
        if (data.type === "create_request") {
          const { action, resource, values } = data.request;
          const request = { action, resource, values };

          self.addDbgMsg("Request sent to CODAP", formatJsonMessage(request));
          let res = yield codapInterface.sendRequest(request);
          self.addDbgMsg("Response from CODAP", formatJsonMessage(res));

          // When the request is to create a graph component, we need to update the sonification
          // store after the run.
          if (action === "create" && resource === "component" && values.type === "graph" && res.success) {
            const root = getRoot(self) as any;
            root.sonificationStore.setGraphs({ selectNewest: true });
          }

          // Prepare for uploading of image file after run if the request is to get dataDisplay
          const graphIdMatch = resource.match(/\[(\d+)\]/);
          const graphID = graphIdMatch?.[1];

          if (res.values.exportDataUri && graphID) {
              // Send data for the attributes on the graph for additional context
            const graphData = yield getGraphAttrData(graphID);
            return [
              { type: "text", text: "Describe this image of the graph for the user."},
              { type: "image_url", image_url: { url: res.values.exportDataUri } },
              { type: "text", text: `Here is data about the graph in the image. Use it to improve your description. ${JSON.stringify(graphData)}`}
            ];
          } else {

            return JSON.stringify(res);
          }
        } else if (data.type === "sonify_graph") {
          const root = getRoot(self) as any;
          if (typeof data.request.graphID === "undefined") {
            throw new Error("graphID is undefined");
          }
          const graph = yield getGraphByID(String(data.request.graphID));

          if (isGraphSonifiable(graph)) {
            root.sonificationStore.setSelectedGraphID(graph.id);
            return `The graph "${graph.name || graph.id}" is ready to be sonified. Tell the user they can use the sonification controls to hear it.`;
          } else {
            return `The graph "${graph.name || graph.id}" is not a numeric scatter plot or univariate dot plot. Tell the user they must select a numeric scatter plot or univariate dot plot to proceed.`;
          }
        }
      } catch (err) {
          console.error("Failed to handle tool call:", err);
          self.addDbgMsg("Failed to handle tool call", formatJsonMessage(err));
          return JSON.stringify({ status: "error", error: err instanceof Error ? err.message : String(err) });
        }
    });

    const sendToolOutputToLlm = flow(function* (toolCallId: string, content: ToolOutput) {
      if (self.isAssistantMocked) return;
      try {
        const reqBody = {
          llmId: self.llmId,
          threadId: self.threadId,
          isToolResponse: true,
          message: {
            tool_call_id: toolCallId,
            content
          }
        };
        const toolOutputResponse = yield postMessage(reqBody, "tool");

        if (!toolOutputResponse.ok) {
          throw new Error(`Failed to send tool response: ${toolOutputResponse.statusText}`);
        }

        return yield toolOutputResponse.json();
      } catch (err) {
        console.error("Failed to send tool response:", err);
        self.addDbgMsg("Failed to send tool response", formatJsonMessage(err));
        throw err;
      }
    });

    const handleMessageSubmit = flow(function* (messageText: string) {
      try {
        self.setShowLoadingIndicator(true);
        if (self.isCancelling || self.isResetting) {
          const description = self.isCancelling ? "Cancelling" : "Resetting";
          self.addDbgMsg(description, `User message added to queue: ${messageText}`);
          self.messageQueue.push(messageText);
        } else {
          self.isLoadingResponse = true;

          // Generate a unique message ID for this request. This lets us cancel the message if needed.
          const messageId = nanoid();
          self.currentMessageId = messageId;

          const reqBody = {
            llmId: self.llmId,
            threadId: self.threadId,
            message: messageText,
            isSystemMessage: false,
            messageId
          };

          // Send message to LangChain server
          const messageResponse = yield postMessage(reqBody, "message");

          if (!messageResponse.ok) {
            throw new Error(`Failed to send message: ${messageResponse.statusText}`);
          }

          let data: IMessageResponse = yield messageResponse.json();
          self.addDbgMsg("Response from server", formatJsonMessage(data));

          // Keep processing tool calls until we get a final response
          while (data?.status === "requires_action" && data?.tool_call_id) {
            const toolOutput = yield processToolCall(data as IToolCallData);
            self.addDbgMsg("Tool output generated", formatJsonMessage(toolOutput));

            // Send tool response back to server
            const toolResponseResult = yield sendToolOutputToLlm(data.tool_call_id, toolOutput);
            self.addDbgMsg("Response to tool output from server", formatJsonMessage(toolResponseResult));

            // Get the next response in the chain
            data = toolResponseResult;
          }

          // Once we're out of the tool call chain, handle the final response.
          if (data.response) {
            self.addDavaiMsg(data.response);
          }
        }
      } catch (err) {
        console.error("Failed to handle message submit:", err);
        self.addDbgMsg("Failed to handle message submit", formatJsonMessage(err));
      } finally {
        self.isLoadingResponse = false;
        self.setShowLoadingIndicator(false);
        self.currentMessageId = null;
      }
    });

    const handleCancel = () => {
      if (self.currentMessageId) {
        cancelRun(self.currentMessageId);
      }
      self.isCancelling = true;
      self.setShowLoadingIndicator(false);
      self.addDavaiMsg("I've cancelled processing your message.");
    };

    const getAttributeData = flow(function* (graphID: string, attrID: string | null) {
      if (!attrID) return { attributeData: null };

      const response = yield Promise.resolve(codapInterface.sendRequest({
        action: "get",
        resource: `component[${graphID}].attribute[${attrID}]`
      }));

      return response?.values
        ? {
            id: response.values.id,
            name: response.values.name,
            values: response.values._categoryMap.__order
          }
        : null;
    });

    const getGraphAttrData = flow(function* (graphID) {
      try {
        const graph = yield getGraphByID(graphID);
        if (graph) {
          const legendAttrData = yield getAttributeData(graphID, graph.legendAttributeID);
          const rightAttrData = yield getAttributeData(graphID, graph.rightSplitAttributeID);
          const topAttrData = yield getAttributeData(graphID, graph.topSplitAttributeID);
          const xAttrData = yield getAttributeData(graphID, graph.xAttributeID);
          const yAttrData = yield getAttributeData(graphID, graph.yAttributeID);
          const y2AttrData = yield getAttributeData(graphID, graph.y2AttributeID);

          const graphAttrData: IGraphAttrData = {
            legend: { attributeData: legendAttrData },
            rightSplit: { attributeData: rightAttrData },
            topSplit: { attributeData: topAttrData },
            xAxis: { attributeData: xAttrData },
            yAxis: { attributeData: yAttrData },
            y2Axis: { attributeData: y2AttrData }
          };

          self.addDbgMsg("Data context for graph", formatJsonMessage(graphAttrData));
          return graphAttrData;
        } else {
          self.addDbgMsg("No graph found with ID", graphID);
          return null;
        }
      } catch (err) {
        console.error("Failed to get graph attribute data:", err);
        self.addDbgMsg("Failed to get graph attribute data", formatJsonMessage(err));
        return null;
      }
    });

    const cancelRun = flow(function* (runId: string) {
      try {
        const reqBody = { messageId: runId };
        const cancelResponse = yield postMessage(reqBody, "cancel");

        if (!cancelResponse.ok) {
          throw new Error(`Failed to cancel run: ${cancelResponse.statusText}`);
        }

        const cancelRes = yield cancelResponse.json();
        self.isCancelling = false;
        self.setShowLoadingIndicator(false);
        self.addDbgMsg(`Cancel request received`, formatJsonMessage(cancelRes));
      } catch (err: any) {
        const errorMessage =
          err instanceof Error
            ? err.message
            : typeof err === "string"
            ? err
            : JSON.stringify(err);
        if (errorMessage.includes("Message not found or already completed")) {
          self.isCancelling = false;
          return;
        } else {
          console.error("Failed to cancel run:", errorMessage);
          self.addDbgMsg("Failed to cancel run", formatJsonMessage(errorMessage));
        }
        self.isCancelling = false;
      }
    });

    // const resetThread = flow(function* () {
    //   try {
    //     self.isResetting = true;
    //     if (self.currentMessageId) {
    //       self.isCancelling = true;
    //       yield cancelRun(self.currentMessageId);
    //     }
    //     const allThreadMessages = self.transcriptStore.messages.map(msg => {
    //       return `${msg.speaker}: ${msg.messageContent.content}`;
    //     }).join("\n");
    //     yield createThread();
    //     yield fetchAndSendDataContexts();
    //     self.addDbgMsg("Sending thread history to LLM", formatJsonMessage(allThreadMessages));
    //     self.isResetting = false;
    //   } catch (err) {
    //     console.error("Failed to reset thread:", err);
    //     self.addDbgMsg("Failed to reset thread", formatJsonMessage(err));
    //     self.isCancelling = false;
    //     self.isResetting = false;
    //   }
    // });

    const createThread = flow(function* () {
      try {
        if (self.currentMessageId) {
          self.isCancelling = true;
          yield cancelRun(self.currentMessageId);
        }
        self.isLoadingResponse = false;
        self.isCancelling = false;
        self.threadId = nanoid();
      } catch (err) {
        console.error("Error creating thread:", err);
      }
    });

    return { cancelRun, createThread, initializeAssistant, handleMessageSubmit, handleCancel, sendDataCtxChangeInfo, sendCODAPDataToLlm, processAndSendCODAPDocumentInfo };
  })
  .actions((self) => ({
    afterCreate() {
      onSnapshot(self, async () => {
        const doneProcessing = !self.isLoadingResponse && !self.isCancelling && !self.isResetting;
        if (self.threadId && doneProcessing && self.codapNotificationQueue.length > 0) {
          // We combine all the queued messages into one for a single request to the LLM.
          const combinedCodapData = self.codapNotificationQueue.reduce((acc, item) => {
            return { ...acc, ...item.codapData };
          }, {});

          try {
            await self.sendCODAPDataToLlm(combinedCodapData);
          } catch (err) {
            console.error("Failed to send system message:", err);
            self.addDbgMsg("Failed to send CODAP document information to LLM", formatJsonMessage(err));
          }

          self.clearCODAPNotificationQueue();
        }
        if (self.threadId && doneProcessing && self.messageQueue.length > 0) {
          const allMsgs = self.messageQueue.join("\n");
          self.clearUserMessageQueue();
          await self.handleMessageSubmit(allMsgs);
        }
      });
    }
  }));

export interface AssistantModelType extends Instance<typeof AssistantModel> {}
