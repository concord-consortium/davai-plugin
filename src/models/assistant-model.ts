import { types, flow, Instance } from "mobx-state-tree";
import { nanoid } from "nanoid";
import { codapInterface } from "@concord-consortium/codap-plugin-api";
import { DAVAI_SPEAKER, DEBUG_SPEAKER } from "../constants";
import { formatJsonMessage, getDataContexts } from "../utils/utils";
import { ChatTranscriptModel } from "./chat-transcript-model";
import { extractDataContexts } from "../utils/data-context-utils";

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
    resource: string;
    values?: any;
  };
  tool_call_id: string;
  type: "CODAP_REQUEST";
}

interface IMessageResponse {
  request?: {
    action: string;
    resource: string;
    values?: any;
  };
  response?: string;
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
        sendCODAPDocumentInfo(`Data contexts: ${JSON.stringify(contexts)}`);
      } catch (err) {
        console.error("Failed to get data contexts:", err);
        self.addDbgMsg("Failed to get data contexts", formatJsonMessage(err));
      }
    });

    const sendDataCtxChangeInfo = flow(function* (msg: string) {
      try {
        if (self.isLoadingResponse || self.isCancelling || self.isResetting) {
          self.codapNotificationQueue.push(msg);
        } else {
          yield sendCODAPDocumentInfo(msg);
        }
      } catch (err) {
        console.error("Failed to send data context info to LLM:", err);
        self.addDbgMsg("Failed to send data context info to the LLM", formatJsonMessage(err));
      }
    });

    const sendCODAPDocumentInfo = flow(function* (message) {
      if (self.isAssistantMocked) return;

      try {
        self.addDbgMsg("Sending CODAP document info to LLM", message);
        if (!self.threadId) {
          self.codapNotificationQueue.push(message);
        } else {
          const extracted = extractDataContexts(message);

          if (extracted) {
            const requestBody = {
              llmId: self.llmId,
              threadId: self.threadId,
              message: "This is a system message containing information about the CODAP document.",
              isSystemMessage: false,
              dataContexts: extracted.dataContexts
            };

            const response = yield postMessage(requestBody);

            if (!response.ok) {
              throw new Error(`Failed to send system message: ${response.statusText}`);
            }

            const data = yield response.json();
            self.addDbgMsg("CODAP document info received by LLM", formatJsonMessage(data));
          } else {
            self.addDbgMsg("Could not extract data contexts from message", message);
          }
        }
      } catch (err) {
        console.error("Failed to send system message:", err);
        self.addDbgMsg("Failed to send CODAP document information to LLM", formatJsonMessage(err));
      }
    });

    const handleToolCall = flow(function* (data: IToolCallData) {
      try {
        const { action, resource, values } = data.request;
        const request = { action, resource, values };
        self.addDbgMsg("Request sent to CODAP", formatJsonMessage(request));
        let res = yield codapInterface.sendRequest(request);
        self.addDbgMsg("Response from CODAP", formatJsonMessage(res));
        // Handle image snapshot requests
        const isImageSnapshotRequest = action === "get" && resource.match(/^dataDisplay/);
        if (isImageSnapshotRequest) {
          self.uploadFileAfterRun = true;
          self.dataUri = res.values.exportDataUri;
          //const graphIdMatch = resource.match(/\[(\d+)\]/);
          // = graphIdMatch?.[1];
          // if (graphID) {
          //   self.dataContextForGraph = yield getGraphAttrData(graphID);
          // }
          // Remove exportDataUri from response
          res = { ...res, values: { ...res.values, exportDataUri: undefined } };
        }

        return JSON.stringify(res);
      } catch (err) {
        console.error("Failed to handle tool call:", err);
        self.addDbgMsg("Failed to handle tool call", formatJsonMessage(err));
        return JSON.stringify({ status: "error", error: err instanceof Error ? err.message : String(err) });
      }
    });

    const sendToolResponse = flow(function* (toolCallId: string, content: string) {
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
        const response = yield postMessage(reqBody);

        if (!response.ok) {
          throw new Error(`Failed to send tool response: ${response.statusText}`);
        }

        const data = yield response.json();
        self.addDavaiMsg(data.response);
      } catch (err) {
        console.error("Failed to send tool response:", err);
        self.addDbgMsg("Failed to send tool response", formatJsonMessage(err));
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

          // Get current data contexts for the message
          const dataContexts = yield getDataContexts();

          const reqBody = {
            llmId: self.llmId,
            threadId: self.threadId,
            message: messageText,
            dataContexts,
            isSystemMessage: false
          }
          // Send message to LangChain server
          const response = yield postMessage(reqBody);

          if (!response.ok) {
            throw new Error(`Failed to send message: ${response.statusText}`);
          }

          const data: IMessageResponse = yield response.json();
          self.addDbgMsg("Message received by server", formatJsonMessage(data));

          // Handle the response
          if (data.type === "CODAP_REQUEST" && data.tool_call_id && data.request) {
            // Handle tool call response
            const toolResponse = yield handleToolCall(data as IToolCallData);
            // Send tool response back to server
            yield sendToolResponse(data.tool_call_id, toolResponse);
          } else if (data.response) {
            // Regular message response
            self.addDavaiMsg(data.response);
          }
        }
      } catch (err) {
        console.error("Failed to handle message submit:", err);
        self.addDbgMsg("Failed to handle message submit", formatJsonMessage(err));
      } finally {
        self.isLoadingResponse = false;
        self.setShowLoadingIndicator(false);
      }
    });

    const handleCancel = () => {
      self.isCancelling = true;
      self.setShowLoadingIndicator(false);
      self.addDavaiMsg("I've cancelled processing your message.");
    };

    // const uploadFile = flow(function* () {
    //   try {
    //     const fileFromDataUri = yield convertBase64ToImage(self.dataUri);
    //     const uploadedFile = yield self.apiConnection?.files.create({
    //       file: fileFromDataUri,
    //       purpose: "vision"
    //     });
    //     return uploadedFile.id;
    //   } catch (err) {
    //     console.error("Failed to upload image:", err);
    //     self.addDbgMsg("Failed to upload image", formatJsonMessage(err));
    //   }
    // });

    // const getAttributeData = flow(function* (graphID: string, attrID: string | null) {
    //   if (!attrID) return { attributeData: null };

    //   const response = yield Promise.resolve(codapInterface.sendRequest({
    //     action: "get",
    //     resource: `component[${graphID}].attribute[${attrID}]`
    //   }));

    //   return response?.values
    //     ? {
    //         id: response.values.id,
    //         name: response.values.name,
    //         values: response.values._categoryMap.__order
    //       }
    //     : null;
    // });

    // const getGraphAttrData = flow(function* (graphID) {
    //   try {
    //     const graph = yield getGraphByID(graphID);
    //     if (graph) {
    //       const legendAttrData = yield getAttributeData(graphID, graph.legendAttributeID);
    //       const rightAttrData = yield getAttributeData(graphID, graph.rightSplitAttributeID);
    //       const topAttrData = yield getAttributeData(graphID, graph.topSplitAttributeID);
    //       const xAttrData = yield getAttributeData(graphID, graph.xAttributeID);
    //       const yAttrData = yield getAttributeData(graphID, graph.yAttributeID);
    //       const y2AttrData = yield getAttributeData(graphID, graph.y2AttributeID);

    //       const graphAttrData: IGraphAttrData = {
    //         legend: { attributeData: legendAttrData },
    //         rightSplit: { attributeData: rightAttrData },
    //         topSplit: { attributeData: topAttrData },
    //         xAxis: { attributeData: xAttrData },
    //         yAxis: { attributeData: yAttrData },
    //         y2Axis: { attributeData: y2AttrData }
    //       };

    //       self.addDbgMsg("Data context for graph", formatJsonMessage(graphAttrData));
    //       return graphAttrData;
    //     } else {
    //       self.addDbgMsg("No graph found with ID", graphID);
    //       return null;
    //     }
    //   } catch (err) {
    //     console.error("Failed to get graph attribute data:", err);
    //     self.addDbgMsg("Failed to get graph attribute data", formatJsonMessage(err));
    //     return null;
    //   }
    // });

    // const sendFileMessage = flow(function* (fileId) {
    //   try {
    //     const res = yield self.apiConnection.beta.threads.messages.create(self.thread.id, {
    //       role: "user",
    //       content: [
    //         {
    //           type: "text",
    //           text: "This is an image of a graph. Describe it for the user."
    //         },
    //         {
    //           type: "image_file",
    //           image_file: {
    //             file_id: fileId
    //           }
    //         },
    //         {
    //           type: "text",
    //           text: `The following JSON data describes key aspects of the graph in the image. Use this context to improve your interpretation and explanation of the graph. ${JSON.stringify(self.dataContextForGraph)}`
    //         }
    //       ]
    //     });
    //     self.addDbgMsg("Image uploaded", formatJsonMessage(res));
    //   } catch (err) {
    //     console.error("Failed to send file message:", err);
    //     self.addDbgMsg("Failed to send file message", formatJsonMessage(err));
    //   }
    // });

    // const handleRequiredAction = flow(function* (runState, runId) {
    //   try {
    //     const toolOutputs = runState.required_action?.submit_tool_outputs.tool_calls
    //       ? yield Promise.all(
    //         runState.required_action.submit_tool_outputs.tool_calls.map(flow(function* (toolCall: any) {
    //           const parsedResult = getParsedData(toolCall);
    //           let output = "";

    //           if (!parsedResult.ok) {
    //             output = "The JSON is invalid; please resend a valid object.";
    //           } else if (toolCall.function.name === "create_request") {
    //             const { action, resource, values } = parsedResult.data;
    //             const request = { action, resource, values };

    //             // When the request is to create a graph component, we need to update the sonification
    //             // store after the run.
    //             if (action === "create" && resource === "component" && values.type === "graph") {
    //               self.updateSonificationStoreAfterRun = true;
    //             }

    //             self.addDbgMsg("Request sent to CODAP", formatJsonMessage(request));
    //             let res = yield codapInterface.sendRequest(request);
    //             self.addDbgMsg("Response from CODAP", formatJsonMessage(res));

    //             // Prepare for uploading of image file after run if the request is to get dataDisplay
    //             const isImageSnapshotRequest = action === "get" && resource.match(/^dataDisplay/);
    //             if (isImageSnapshotRequest) {
    //               self.uploadFileAfterRun = true;
    //               self.dataUri = res.values.exportDataUri;
    //               const graphIdMatch = resource.match(/\[(\d+)\]/);
    //               const graphID = graphIdMatch?.[1];
    //               if (graphID) {
    //                 // Send data for the attributes on the graph for additional context
    //                 // self.dataContextForGraph = yield getGraphAttrData(graphID);
    //               } else {
    //                 self.addDbgMsg("Could not extract graphID from resource string", resource);
    //                 self.dataContextForGraph = null;
    //               }
    //             }
    //             // remove any exportDataUri value that exists since it can be large and we don't need to send it to the assistant
    //             res = isImageSnapshotRequest
    //               ? { ...res, values: { ...res.values, exportDataUri: undefined } }
    //               : res;

    //             output = JSON.stringify(res);
    //           } else if (toolCall.function.name === "sonify_graph") {
    //             const root = getRoot(self) as any;
    //             const graph = yield getGraphByID(parsedResult.data.graphID);

    //             if (isGraphSonifiable(graph)) {
    //               root.sonificationStore.setSelectedGraphID(graph.id);
    //               output = `The graph "${graph.name || graph.id}" is ready to be sonified. Tell the user they can use the sonification controls to hear it.`;
    //             } else {
    //               output = `The graph "${graph.name || graph.id}" is not a numeric scatter plot or univariate dot plot. Tell the user they must select a numeric scatter plot or univariate dot plot to proceed.`;
    //             }
    //           } else {
    //             output = `The tool call "${toolCall.function.name}" is not recognized.`;
    //           }

    //           return { tool_call_id: toolCall.id, output };
    //         })
    //       ))
    //       : [];

    //     self.addDbgMsg("Tool outputs being submitted", formatJsonMessage(toolOutputs));
    //     yield self.apiConnection.beta.threads.runs.submitToolOutputs(self.thread.id, runId, { tool_outputs: toolOutputs });
    //   } catch (err) {
    //     console.error(err);
    //     self.addDbgMsg("Error taking required action", formatJsonMessage(err));
    //   }
    // });

    const cancelRun = flow(function* (runId: string) {
      try {
        // const cancelRes = yield self.apiConnection.beta.threads.runs.cancel(self.threadId, runId);
        // for now, mock the cancel response
        const cancelRes = yield Promise.resolve({
          status: "cancelled",
          run_id: runId,
          thread_id: self.threadId,
          message: "Run cancelled successfully"
        });
        self.addDbgMsg(`Cancel request received`, formatJsonMessage(cancelRes));
      } catch (err: any) {
        const errorMessage =
          err instanceof Error
            ? err.message
            : typeof err === "string"
            ? err
            : JSON.stringify(err);
        if (errorMessage.includes("Cannot cancel run with status 'cancelled'")) {
          self.isCancelling = false;
          return;
        } else {
          console.error("Failed to cancel run:", errorMessage);
          self.addDbgMsg("Failed to cancel run", formatJsonMessage(errorMessage));
        }
        self.isCancelling = false;
      }
    });

    const resetThread = flow(function* () {
      try {
        self.isResetting = true;
        // const allThreadMessages = yield self.apiConnection.beta.threads.messages.list(self.threadId);
        // const allThreadMessages = self.transcriptStore.getAllMessages();
        const allThreadMessages = self.transcriptStore.messages.map(msg => {
          return `${msg.speaker}: ${msg.messageContent.content}`;
        }).join("\n");
        yield createThread();
        yield fetchAndSendDataContexts();
        self.addDbgMsg("Sending thread history to LLM", formatJsonMessage(allThreadMessages));
        // yield self.apiConnection.beta.threads.messages.create(self.threadId, {
        //   role: "user",
        //   content: `This is a system message containing the previous conversation history. ${allThreadMessages}`,
        // });
        self.isResetting = false;
      } catch (err) {
        console.error("Failed to reset thread:", err);
        self.addDbgMsg("Failed to reset thread", formatJsonMessage(err));
        self.isCancelling = false;
        self.isResetting = false;
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

    return { cancelRun, createThread, initializeAssistant, handleMessageSubmit, handleCancel, resetThread, sendDataCtxChangeInfo, sendCODAPDocumentInfo };
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
