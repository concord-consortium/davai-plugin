import { types, flow, Instance, getRoot, onSnapshot } from "mobx-state-tree";
import { nanoid } from "nanoid";
import { codapInterface } from "@concord-consortium/codap-plugin-api";
import { DAVAI_SPEAKER, DEBUG_SPEAKER } from "../constants";
import { formatJsonMessage } from "../utils/utils";
import { getDataContexts, getGraphAttrData, getGraphByID, getTrimmedGraphDetails } from "../utils/codap-api-utils";
import { isGraphSonifiable } from "../utils/graph-sonification-utils";
import { ChatTranscriptModel } from "./chat-transcript-model";
import { IToolCallData, IMessageResponse, ToolOutput } from "../types";
import { postMessage } from "../utils/llm-utils";

/**
 * AssistantModel encapsulates the AI assistant and its interactions with the user.
 * It includes properties and methods for configuring the assistant, handling chat interactions, and maintaining the assistant's
 * thread and transcript.
 *
 * @property {boolean} isCancelling - Flag indicating whether the assistant is currently cancelling a request.
 * @property {boolean} isLoadingResponse - Flag indicating whether the assistant is currently processing a response.
 * @property {boolean} isResetting - Flag indicating whether the assistant is currently resetting the chat.
 * @property {string} llmId - The unique ID string of the LLM being used, or `null` if not initialized.
 * @property {string[]} messageQueue - Queue of messages to be sent to the assistant. Used if user sends messages while assistant is processing a response.
 * @property {boolean} showLoadingIndicator - Flag indicating whether to show a loading indicator to the user; this is decoupled from the assistant's internal loading state to allow for more control over UI elements.
 * @property {Object|null} thread - The assistant's thread used for the current chat, or `null` if no thread is active.
 * @property {ChatTranscriptModel} transcriptStore - The assistant's chat transcript store for recording and managing chat messages.
 */
export const AssistantModel = types
  .model("AssistantModel", {
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
    dataContexts: null as any,
    graphs: null as any,
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
    clearUserMessageQueue() {
      self.messageQueue.clear();
    }
  }))
  .actions((self) => {
    const initializeAssistant = flow (function* (llmId: string) {
      try {
        self.setLlmId(llmId);
        self.setThreadId(nanoid());
        yield updateDataContexts();
        yield updateGraphs();
        self.addDbgMsg("Assistant initialized", `Assistant ID: ${llmId}, Thread ID: ${self.threadId}`);
      } catch (err) {
        console.error("Failed to initialize assistant:", err);
        self.addDbgMsg("Failed to initialize assistant", formatJsonMessage(err));
      }
    });

    const updateDataContexts = flow(function* () {
      try {
        const dataContexts = yield getDataContexts();
        self.dataContexts = dataContexts;
        self.addDbgMsg("Updated data contexts", formatJsonMessage(dataContexts));
      } catch (err) {
        console.error("Failed to update data contexts:", err);
        self.addDbgMsg("Failed to update data contexts", formatJsonMessage(err));
      }
    });

    const updateGraphs = flow(function* () {
      try {
        const graphs = yield getTrimmedGraphDetails();
        self.graphs = graphs;
        self.addDbgMsg("Updated graphs", formatJsonMessage(graphs));
      } catch (err) {
        console.error("Failed to update graphs:", err);
        self.addDbgMsg("Failed to update graphs", formatJsonMessage(err));
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

          if (res.success === false) {
            console.error("CODAP request failed:", res);
            return JSON.stringify(res);
          }

          // When the request is to create a graph component, we need to update the sonification
          // store after the run.
          if (action === "create" && resource === "component" && values.type === "graph") {
            const root = getRoot(self) as any;
            root.sonificationStore.setGraphs({ selectNewest: true });
          }

          // Prepare for uploading of image file after run if the request is to get dataDisplay
          const graphIdMatch = resource.match(/\[(\d+)\]/);
          const graphID = graphIdMatch?.[1];

          if (res.values?.exportDataUri && graphID) {
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
            dataContexts: self.dataContexts,
            graphs: self.graphs,
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

    const handleCancel = flow(function* () {
      try {
        if (self.currentMessageId && self.threadId) {
          self.isCancelling = true;
          self.setShowLoadingIndicator(false);

          self.addDavaiMsg("I've cancelled processing your message.");
          const reqBody = {
            messageId: self.currentMessageId,
            threadId: self.threadId
          };

          const cancelResponse = yield postMessage(reqBody, "cancel");

          if (!cancelResponse.ok) {
            throw new Error(`Failed to cancel run: ${cancelResponse.statusText}`);
          }

          const cancelRes = yield cancelResponse.json();
          self.addDbgMsg(`Cancel request received`, formatJsonMessage(cancelRes));
        }
       } catch (err: any) {
          const errorMessage = err instanceof Error ? err.message : String(err);
          if (!errorMessage.includes("Message not found or already completed")) {
            console.error("Failed to cancel run:", errorMessage);
            self.addDbgMsg("Failed to cancel run", formatJsonMessage(errorMessage));
          }
        } finally {
          self.isCancelling = false;
          self.setShowLoadingIndicator(false);
        }
    });

    const createThread = flow(function* () {
      try {
        if (self.currentMessageId) {
          self.isCancelling = true;
          yield handleCancel();
        }
        self.isLoadingResponse = false;
        self.isCancelling = false;
        self.threadId = nanoid();
      } catch (err) {
        console.error("Error creating thread:", err);
      }
    });

    return { createThread, initializeAssistant, handleMessageSubmit, handleCancel, updateDataContexts, updateGraphs };
  })
  .actions((self) => ({
    afterCreate() {
      onSnapshot(self, async () => {
        const doneProcessing = !self.isLoadingResponse && !self.isCancelling && !self.isResetting;
        if (self.threadId && doneProcessing && self.messageQueue.length > 0) {
          const allMsgs = self.messageQueue.join("\n");
          self.clearUserMessageQueue();
          await self.handleMessageSubmit(allMsgs);
        }
      });
    }
  }));

export interface AssistantModelType extends Instance<typeof AssistantModel> {}
