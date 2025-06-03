import { types, flow, Instance, onSnapshot, getRoot } from "mobx-state-tree";
import { OpenAI } from "openai";
import { Message } from "openai/resources/beta/threads/messages";
import { codapInterface } from "@concord-consortium/codap-plugin-api";
import { DAVAI_SPEAKER, DEBUG_SPEAKER, WAIT_STATES, ERROR_STATES } from "../constants";
import { convertBase64ToImage, formatJsonMessage, getGraphByID, getDataContexts, getParsedData, isGraphSonifiable } from "../utils/utils";
import { requestThreadDeletion } from "../utils/openai-utils";
import { ChatTranscriptModel } from "./chat-transcript-model";

const OpenAIType = types.custom({
  name: "OpenAIType",
  fromSnapshot(snapshot: OpenAI) {
    return new OpenAI({
      apiKey: snapshot.apiKey,
      dangerouslyAllowBrowser: true,
    });
  },
  toSnapshot() {
    return undefined; // OpenAI instance is non-serializable
  },
  isTargetType(value) {
    return value instanceof OpenAI;
  },
  getValidationMessage() {
    return "";
  },
});

interface IGraphAttrData {
  legend?: Record<string, any>;
  rightSplit?: Record<string, any>;
  topSplit?: Record<string, any>;
  xAxis?: Record<string, any>;
  yAxis?: Record<string, any>;
}

/**
 * AssistantModel encapsulates the AI assistant and its interactions with the user.
 * It includes properties and methods for configuring the assistant, handling chat interactions, and maintaining the assistant's
 * thread and transcript.
 *
 * @property {Object} apiConnection - The API connection object for interacting with the assistant
 * @property {Object|null} assistant - The assistant object, or `null` if not initialized.
 * @property {string} assistantId - The unique ID of the assistant being used, or `null` if not initialized.
 * @property {Object} assistantList - A map of available assistants, where the key is the assistant ID and the value is the assistant name.
 * @property {string[]} codapNotificationQueue - Queue of messages to be sent to the assistant. Used if CODAP generates notifications while assistant is processing a response.
 * @property {string} dataUri - The data URI of the file to be uploaded.
 * @property {boolean} isCancelling - Flag indicating whether the assistant is currently cancelling a request.
 * @property {boolean} isLoadingResponse - Flag indicating whether the assistant is currently processing a response.
 * @property {boolean} isResetting - Flag indicating whether the assistant is currently resetting the chat.
 * @property {string[]} messageQueue - Queue of messages to be sent to the assistant. Used if user sends messages while assistant is processing a response.
 * @property {boolean} showLoadingIndicator - Flag indicating whether to show a loading indicator to the user; this is decoupled from the assistant's internal loading state to allow for more control over UI elements.
 * @property {Object|null} thread - The assistant's thread used for the current chat, or `null` if no thread is active.
 * @property {ChatTranscriptModel} transcriptStore - The assistant's chat transcript store for recording and managing chat messages.
 * @property {boolean} uploadFileAfterRun - Flag indicating whether to upload a file after the assistant completes a run.
 */
export const AssistantModel = types
  .model("AssistantModel", {
    apiConnection: OpenAIType,
    assistant: types.maybe(types.frozen()),
    assistantId: types.string,
    assistantList: types.optional(types.map(types.string), {}),
    codapNotificationQueue: types.array(types.string),
    isCancelling: types.optional(types.boolean, false),
    isLoadingResponse: types.optional(types.boolean, false),
    isResetting: types.optional(types.boolean, false),
    messageQueue: types.array(types.string),
    showLoadingIndicator: types.optional(types.boolean, false),
    thread: types.maybe(types.frozen()),
    transcriptStore: ChatTranscriptModel
  })
  .volatile(() => ({
    dataContextForGraph: null as IGraphAttrData | null,
    dataUri: "",
    uploadFileAfterRun: false,
    updateSonificationStoreAfterRun: false,
  }))
  .actions((self) => ({
    addDavaiMsg(msg: string) {
      self.transcriptStore.addMessage(DAVAI_SPEAKER, { content: msg });
    },
    addDbgMsg (description: string, content: any) {
      self.transcriptStore.addMessage(DEBUG_SPEAKER, { description, content });
    }
  }))
  .actions((self) => ({
    handleMessageSubmitMockAssistant() {
      self.showLoadingIndicator = true;
      // Use a brief delay to prevent duplicate timestamp-based keys.
      setTimeout(() => {
        self.addDavaiMsg("I'm just a mock assistant and can't process that request.");
        self.showLoadingIndicator = false;
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
    const initializeAssistant = flow(function* () {
      if (self.assistantId === "mock") return;

      try {
        if (!self.apiConnection) throw new Error("API connection is not initialized");
        self.assistant  = yield self.apiConnection.beta.assistants.retrieve(self.assistantId);
        self.thread = yield self.apiConnection.beta.threads.create();
        self.addDbgMsg("You are chatting with assistant", formatJsonMessage(self.assistant));
        self.addDbgMsg("New thread created", formatJsonMessage(self.thread));
        fetchAndSendDataContexts();
      } catch (err) {
        console.error("Failed to initialize assistant:", err);
        self.addDbgMsg("Failed to initialize assistant", formatJsonMessage(err));
      }
    });

    const fetchAssistantsList = flow(function* () {
      try{
        self.assistantList = self.assistantList ?? types.map(types.string).create();
        const res = yield self.apiConnection.beta.assistants.list();
        res.data.map((assistant: OpenAI.Beta.Assistant) => {
          const assistantName = assistant.name || assistant.id;
          self.assistantList?.set(assistant.id, assistantName);
        });
      } catch (err) {
        console.error(err);
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
      try {
        self.addDbgMsg("Sending CODAP document info to LLM", message);
        if (!self.thread?.id) {
          self.codapNotificationQueue.push(message);
        } else {
          const messageSent = yield self.apiConnection.beta.threads.messages.create(self.thread.id, {
            role: "user",
            content: `This is a system message containing information about the CODAP document. ${message}`,
          });
          self.addDbgMsg("CODAP document info received by LLM", formatJsonMessage(messageSent));
        }
      }
      catch (err) {
        console.error("Failed to send system message:", err);
        self.addDbgMsg("Failed to send CODAP document information to LLM", formatJsonMessage(err));
      }
    });

    const handleMessageSubmit = flow(function* (messageText) {
      try {
        self.showLoadingIndicator = true;
        if (self.isCancelling || self.isResetting) {
          const description = self.isCancelling ? "Cancelling" : "Resetting";
          self.addDbgMsg(description, `User message added to queue: ${messageText}`);
          self.messageQueue.push(messageText);
        } else {
          self.isLoadingResponse = true;
          const messageSent = yield self.apiConnection.beta.threads.messages.create(self.thread.id, {
            role: "user",
            content: messageText,
          });
          self.addDbgMsg("Message received by LLM", formatJsonMessage(messageSent));
          yield startRun();
        }
      } catch (err) {
        console.error("Failed to handle message submit:", err);
        self.addDbgMsg("Failed to handle message submit", formatJsonMessage(err));
        self.isLoadingResponse = false;
        self.showLoadingIndicator = false;
      }
    });

    const startRun = flow(function* () {
      try {
        const run = yield self.apiConnection.beta.threads.runs.create(self.thread.id, {
          assistant_id: self.assistant.id,
        });
        yield pollRunState(run.id);
      } catch (err) {
        console.error("Failed to start run:", err);
        self.addDbgMsg("Failed to start run", formatJsonMessage(err) );
      }
    });

    const handleCancel = () => {
      self.isCancelling = true;
      self.showLoadingIndicator = false;
      self.addDavaiMsg("I've cancelled processing your message.");
    };

    const pollRunState: (currentRunId: string) => Promise<any> = flow(function* (currentRunId) {
      try {
        let runState = yield self.apiConnection.beta.threads.runs.retrieve(self.thread.id, currentRunId);
        self.addDbgMsg("Run state status", formatJsonMessage(runState.status));

        while (WAIT_STATES.has(runState.status) && !self.isCancelling) {
          yield new Promise((resolve) => setTimeout(resolve, 1000));
          runState = yield self.apiConnection.beta.threads.runs.retrieve(self.thread.id, currentRunId);
          self.addDbgMsg("Run state status", formatJsonMessage(runState.status));
        }

        if (self.isCancelling) {
          yield cancelRun(currentRunId);
        }

        else if (ERROR_STATES.has(runState.status)) {
          self.addDbgMsg("Run state error", formatJsonMessage(runState));
          self.addDavaiMsg("I'm sorry, I encountered an error. Please submit your request again.");
        }

        else if (runState.status === "requires_action") {
          self.addDbgMsg("Run requires action", formatJsonMessage(runState.required_action));
          yield handleRequiredAction(runState, currentRunId);
          yield pollRunState(currentRunId);
        }

        else if (runState.status === "completed") {
          if (self.uploadFileAfterRun && self.dataUri) {
            const fileId = yield uploadFile();
            yield sendFileMessage(fileId);
            self.uploadFileAfterRun = false;
            self.dataUri = "";
            self.dataContextForGraph = null;
            startRun();
          } else {
            const messages = yield self.apiConnection.beta.threads.messages.list(self.thread.id);

            const lastMessageForRun = messages.data
              .filter((msg: Message) => msg.run_id === currentRunId && msg.role === "assistant")
              .pop();

            self.addDbgMsg("Run completed, assistant response", formatJsonMessage(lastMessageForRun));

            const msgContent = lastMessageForRun?.content[0]?.text?.value || "I'm sorry, I don't have a response for that.";
            self.addDavaiMsg(msgContent);

            if (self.updateSonificationStoreAfterRun) {
              self.updateSonificationStoreAfterRun = false;
              const root = getRoot(self) as any;
              root.sonificationStore.setGraphs({ selectNewest: true });
            }
          }
        }
      } catch (err) {
        console.error("Error polling run state:", err);
        self.addDbgMsg("Error polling run state", formatJsonMessage(err));
      } finally {
        self.isLoadingResponse = false;
        self.showLoadingIndicator = false;
      }
    });

    const uploadFile = flow(function* () {
      try {
        const fileFromDataUri = yield convertBase64ToImage(self.dataUri);
        const uploadedFile = yield self.apiConnection?.files.create({
          file: fileFromDataUri,
          purpose: "vision"
        });
        return uploadedFile.id;
      } catch (err) {
        console.error("Failed to upload image:", err);
        self.addDbgMsg("Failed to upload image", formatJsonMessage(err));
      }
    });

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

          // Combine y-axis data if we have a second y-axis
          const combinedYAxisData = y2AttrData.attributeData 
            ? { attributeData: [yAttrData.attributeData, y2AttrData.attributeData] }
            : yAttrData;

          const graphAttrData = {
            legend: { attributeData: legendAttrData },
            rightSplit: { attributeData: rightAttrData },
            topSplit: { attributeData: topAttrData },
            xAxis: { attributeData: xAttrData },
            yAxis: { attributeData: combinedYAxisData },
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

    const sendFileMessage = flow(function* (fileId) {
      try {
        const res = yield self.apiConnection.beta.threads.messages.create(self.thread.id, {
          role: "user",
          content: [
            {
              type: "text",
              text: "This is an image of a graph. Describe it for the user."
            },
            {
              type: "image_file",
              image_file: {
                file_id: fileId
              }
            },
            {
              type: "text",
              text: `The following JSON data describes key aspects of the graph in the image. Use this context to improve your interpretation and explanation of the graph. ${JSON.stringify(self.dataContextForGraph)}`
            }
          ]
        });
        self.addDbgMsg("Image uploaded", formatJsonMessage(res));
      } catch (err) {
        console.error("Failed to send file message:", err);
        self.addDbgMsg("Failed to send file message", formatJsonMessage(err));
      }
    });

    const handleRequiredAction = flow(function* (runState, runId) {
      try {
        const toolOutputs = runState.required_action?.submit_tool_outputs.tool_calls
          ? yield Promise.all(
            runState.required_action.submit_tool_outputs.tool_calls.map(flow(function* (toolCall: any) {
              const parsedResult = getParsedData(toolCall);
              let output = "";

              if (!parsedResult.ok) {
                output = "The JSON is invalid; please resend a valid object.";
              } else if (toolCall.function.name === "create_request") {
                const { action, resource, values } = parsedResult.data;
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
                }
                // remove any exportDataUri value that exists since it can be large and we don't need to send it to the assistant
                res = isImageSnapshotRequest
                  ? { ...res, values: { ...res.values, exportDataUri: undefined } }
                  : res;

                output = JSON.stringify(res);
              } else if (toolCall.function.name === "sonify_graph") {
                const root = getRoot(self) as any;
                const graph = yield getGraphByID(parsedResult.data.graphID);

                if (isGraphSonifiable(graph)) {
                  root.sonificationStore.setSelectedGraphID(graph.id);
                  output = `The graph "${graph.name || graph.id}" is ready to be sonified. Tell the user they can use the sonification controls to hear it.`;
                } else {
                  output = `The graph "${graph.name || graph.id}" is not a numeric scatter plot or univariate dot plot. Tell the user they must select a numeric scatter plot or univariate dot plot to proceed.`;
                }
              } else {
                output = `The tool call "${toolCall.function.name}" is not recognized.`;
              }

              return { tool_call_id: toolCall.id, output };
            })
          ))
          : [];

        self.addDbgMsg("Tool outputs being submitted", formatJsonMessage(toolOutputs));
        yield self.apiConnection.beta.threads.runs.submitToolOutputs(self.thread.id, runId, { tool_outputs: toolOutputs });
      } catch (err) {
        console.error(err);
        self.addDbgMsg("Error taking required action", formatJsonMessage(err));
      }
    });

    const cancelRun = flow(function* (runId: string) {
      try {
        const cancelRes = yield self.apiConnection.beta.threads.runs.cancel(self.thread.id, runId);
        self.addDbgMsg(`Cancel request received`, formatJsonMessage(cancelRes));
        pollCancel(runId);
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

    const pollCancel = flow(function* (runId: string) {
      try {
        const startTime = Date.now();
        let runState = yield self.apiConnection.beta.threads.runs.retrieve(self.thread.id, runId);
        const MAX_WAIT_TIME = 10_000; // 10 seconds

        while (runState.status === "cancelling") {
          const elapsed = Date.now() - startTime;
          if (elapsed >= MAX_WAIT_TIME) {
            yield resetThread();
            break;
          }
          yield new Promise(resolve => setTimeout(resolve, 2000));
          runState = yield self.apiConnection.beta.threads.runs.retrieve(self.thread.id, runId);
          self.addDbgMsg("Cancellation status", `Run ${runId} has status: ${runState.status}.`);
        }

        if (runState.status === "cancelled") {
          self.addDbgMsg("Run cancelled", `Run ${runId} has been cancelled.`);
        }
      } catch (err) {
        console.error("Background poll cancel error:", err);
      } finally {
        self.isCancelling = false;
      }
    });

    const resetThread = flow(function* () {
      try {
        self.isResetting = true;
        const threadId = self.thread.id;
        const allThreadMessages = yield self.apiConnection.beta.threads.messages.list(threadId);
        yield deleteThread();
        yield createThread();
        yield fetchAndSendDataContexts();
        self.addDbgMsg("Sending thread history to LLM", formatJsonMessage(allThreadMessages));
        yield self.apiConnection.beta.threads.messages.create(self.thread.id, {
          role: "user",
          content: `This is a system message containing the previous conversation history. ${allThreadMessages}`,
        });
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
        const newThread = yield self.apiConnection.beta.threads.create();
        self.thread = newThread;
      } catch (err) {
        console.error("Error creating thread:", err);
      }
    });

    const deleteThread = flow(function* () {
      try {
        if (!self.thread) {
          console.warn("No thread to delete.");
          return;
        }

        const threadId = self.thread.id;
        yield requestThreadDeletion(threadId);
        self.addDbgMsg("Thread deleted", `Thread with ID ${threadId} deleted`);
        self.thread = undefined;

      } catch (err) {
        console.error("Error deleting thread:", err);
      }
    });

    return { createThread, deleteThread, initializeAssistant, fetchAssistantsList, handleMessageSubmit, handleCancel, sendDataCtxChangeInfo, sendCODAPDocumentInfo };
  })
  .actions((self) => ({
    afterCreate() {
      onSnapshot(self, async () => {
        const doneProcessing = !self.isLoadingResponse && !self.isCancelling && !self.isResetting;
        if (self.thread?.id && doneProcessing && self.codapNotificationQueue.length > 0) {
          const allMsgs = self.codapNotificationQueue.join("\n");
          self.codapNotificationQueue.clear();
          await self.sendCODAPDocumentInfo(allMsgs);
        } else if (self.thread?.id && doneProcessing && self.messageQueue.length > 0) {
          const allMsgs = self.messageQueue.join("\n");
          self.messageQueue.clear();
          await self.handleMessageSubmit(allMsgs);
        }
      });

      if (self.apiConnection) {
        self.fetchAssistantsList();
      }
    }
  }));

export interface AssistantModelType extends Instance<typeof AssistantModel> {}
