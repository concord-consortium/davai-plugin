import { types, flow, Instance, getRoot } from "mobx-state-tree";
import { nanoid } from "nanoid";
import { codapInterface } from "@concord-consortium/codap-plugin-api";
import { DAVAI_SPEAKER, DEBUG_SPEAKER } from "../constants";
import { formatJsonMessage, getGraphByID, isGraphSonifiable } from "../utils/utils";
import { ChatTranscriptModel } from "./chat-transcript-model";

interface IGraphAttrData {
  legend?: Record<string, any>;
  rightSplit?: Record<string, any>;
  topSplit?: Record<string, any>;
  xAxis?: Record<string, any>;
  yAxis?: Record<string, any>;
  y2Axis?: Record<string, any>;
}

interface IToolCallData {
  request: {
    action: string;
    graphID?: string;
    resource: string;
    values?: any;
  };
  tool_call_id: string;
  type: string;
}

interface IMessageResponse {
  request?: {
    action: string;
    resource: string;
    values?: any;
  };
  response?: string;
  status?: string;
  tool_call_id?: string;
  type: "CODAP_REQUEST" | "MESSAGE";
}

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
    codapNotificationQueue: types.array(types.string),
    isCancelling: types.optional(types.boolean, false),
    isLoadingResponse: types.optional(types.boolean, false),
    isResetting: types.optional(types.boolean, false),
    messageQueue: types.array(types.string),
    showLoadingIndicator: types.optional(types.boolean, false),
    threadId: types.maybe(types.string),
    transcriptStore: ChatTranscriptModel,
  })
  .volatile(() => ({
    dataContextForGraph: null as IGraphAttrData | null,
    dataUri: "",
    uploadFileAfterRun: false,
    updateSonificationStoreAfterRun: false,
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
    addMessageToCODAPNotificationQueue(msg: string) {
      self.codapNotificationQueue.push(msg);
    }
  }))
  .actions((self) => {
    const initializeAssistant = (() => {
      try {
        self.setThreadId(nanoid());
        self.addDbgMsg("Assistant initialized", `Assistant ID: ${self.llmId}, Thread ID: ${self.threadId}`);
      } catch (err) {
        console.error("Failed to initialize assistant:", err);
        self.addDbgMsg("Failed to initialize assistant", formatJsonMessage(err));
      }
    });

    const sendCODAPDocumentInfo = flow(function* (message) {
      if (self.isAssistantMocked) return;

      try {
        self.addDbgMsg("Sending CODAP document info to vector store", message);
        if (!self.threadId) {
          self.codapNotificationQueue.push(message);
        } else {
          // Send document state to dedicated document endpoint (no LLM calls)
          const requestBody = {
            threadId: self.threadId,
            documentState: message
          };

          const documentResponse = yield fetch(`${process.env.LANGCHAIN_SERVER_URL}/document`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify(requestBody),
          });

          if (!documentResponse.ok) {
            throw new Error(`Failed to update document: ${documentResponse.statusText}`);
          }

          const data = yield documentResponse.json();
          self.addDbgMsg("CODAP document updated in vector store", formatJsonMessage(data));
        }
      } catch (err) {
        console.error("Failed to update document:", err);
        self.addDbgMsg("Failed to update CODAP document in vector store", formatJsonMessage(err));
      }
    });

    const handleToolCall = flow(function* (data: IToolCallData) {
      try {
        if (data.type === "create_request") {
          const { action, resource, values } = data.request;
          const request = { action, resource, values };

          // When the request is to create a graph component, we need to update the sonification
          // store after the run.
          if (action === "create" && resource === "component" && values.type === "graph") {
            self.updateSonificationStoreAfterRun = true;
          }

          self.addDbgMsg("Request sent to CODAP", formatJsonMessage(request));
          let res = yield codapInterface.sendRequest(request);
          self.addDbgMsg("Response from CODAP", formatJsonMessage(res));

          // Prepare for uploading of image file after run if the request is to get dataDisplay
          const isImageSnapshotRequest = action === "get" && resource.match(/^dataDisplay/);
          if (isImageSnapshotRequest) {
            self.uploadFileAfterRun = true;
            self.dataUri = res.values.exportDataUri;
            const graphIdMatch = resource.match(/\[(\d+)\]/);
            const graphID = graphIdMatch?.[1];
            if (graphID) {
              // Send data for the attributes on the graph for additional context
              self.dataContextForGraph = yield getGraphAttrData(graphID);
            } else {
              self.addDbgMsg("Could not extract graphID from resource string", resource);
              self.dataContextForGraph = null;
            }
            // remove any exportDataUri value that exists since it can be large and we don't need to send it to the assistant
            res = isImageSnapshotRequest
              ? { ...res, values: { ...res.values, exportDataUri: undefined } }
              : res;
          }

          return JSON.stringify(res);

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

    const sendToolOutputToLlm = flow(function* (toolCallId: string, content: string) {
      if (self.isAssistantMocked) return;

      try {
        const reqBody = {
            llmId: self.llmId,
            threadId: self.threadId,
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
          self.addDbgMsg("Message received by server", formatJsonMessage(data));

          // Keep processing tool calls until we get a final response
          while (data?.status === "requires_action" && data?.tool_call_id) {
            const toolOutput = yield handleToolCall(data as IToolCallData);

            // Send tool response back to server
            const toolResponseResult = yield sendToolOutputToLlm(data.tool_call_id, toolOutput);

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

    const createThread = flow(function* () {
      try {
        // const newThread = yield self.apiConnection.beta.threads.create();
        const newThread = yield Promise.resolve({
          id: nanoid(),
          name: "New Thread",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        });
        console.log("New thread created:", newThread);
        self.threadId = nanoid();
      } catch (err) {
        console.error("Error creating thread:", err);
      }
    });

    return { cancelRun, createThread, initializeAssistant, handleMessageSubmit, handleCancel, sendCODAPDocumentInfo };
  })
  .actions((self) => ({
    // afterCreate() {
    //   onSnapshot(self, async () => {
    //     const doneProcessing = !self.isLoadingResponse && !self.isCancelling && !self.isResetting;
    //     if (self.threadId && doneProcessing && self.codapNotificationQueue.length > 0) {
    //       const allMsgs = self.codapNotificationQueue.join("\n");
    //       self.codapNotificationQueue.clear();
    //       await self.sendCODAPDocumentInfo(allMsgs);
    //     } else if (self.threadId && doneProcessing && self.messageQueue.length > 0) {
    //       const allMsgs = self.messageQueue.join("\n");
    //       self.messageQueue.clear();
    //       await self.handleMessageSubmit(allMsgs);
    //     }
    //   });
    // }
  }));

export interface AssistantModelType extends Instance<typeof AssistantModel> {}
