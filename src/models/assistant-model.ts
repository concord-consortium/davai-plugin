import { types, flow, Instance, getRoot, onSnapshot } from "mobx-state-tree";
import { nanoid } from "nanoid";
import { codapInterface } from "@concord-consortium/codap-plugin-api";
import { DAVAI_SPEAKER, DEBUG_SPEAKER, STREAMING_STATUS } from "../constants";
import { appendedText } from "../utils/stream-utils";
import { formatJsonMessage, formatElapsedTime } from "../utils/utils";
import { getDataContexts, getGraphAttrData, getGraphByID, getTrimmedGraphDetails } from "../utils/codap-api-utils";
import { isGraphSonifiable } from "../utils/graph-sonification-utils";
import { ChatTranscriptModel } from "./chat-transcript-model";
import { IToolCallData, IToolRequestError, IMessageResponse, ToolOutput } from "../types";
import { postMessage } from "../utils/llm-utils";

// A tool call the server could not prepare comes back as an error payload rather
// than a normal CODAP request. This guard narrows the union so the normal path can
// safely use action/resource/etc.
const isToolRequestError = (request: IToolCallData["request"]): request is IToolRequestError =>
  "status" in request && request.status === "error";

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
    currentStreamingMessageId: null as string | null,
    streamEnabled: true as boolean,
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
    },
    setStreamEnabled(enabled: boolean) {
      self.streamEnabled = enabled;
    },
    ingestStreamChunk(cumulative: string) {
      if (!self.currentStreamingMessageId) {
        self.showLoadingIndicator = false; // replace the Processing row with the streamed message
        self.currentStreamingMessageId =
          self.transcriptStore.addStreamingMessage(DAVAI_SPEAKER, { content: "" });
      }
      const id = self.currentStreamingMessageId;
      const msg = self.transcriptStore.messages.find((m) => m.id === id);
      const shown = msg?.messageContent.content ?? "";
      const added = appendedText(shown, cumulative);
      if (added) self.transcriptStore.appendToMessage(id, added);
    },
    finalizeStream(fullText: string) {
      if (self.currentStreamingMessageId) {
        self.transcriptStore.finalizeStreamingMessage(self.currentStreamingMessageId, fullText);
        self.currentStreamingMessageId = null;
      } else {
        self.transcriptStore.addMessage(DAVAI_SPEAKER, { content: fullText });
      }
    },
    discardStream() {
      if (self.currentStreamingMessageId) {
        self.transcriptStore.removeMessage(self.currentStreamingMessageId);
        self.currentStreamingMessageId = null;
      }
    },
    finishStream() {
      if (self.currentStreamingMessageId) {
        const msg = self.transcriptStore.messages.find((m) => m.id === self.currentStreamingMessageId);
        self.transcriptStore.finalizeStreamingMessage(self.currentStreamingMessageId, msg?.messageContent.content ?? "");
        self.currentStreamingMessageId = null;
      }
    },
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
        // A tool call the server couldn't prepare comes back as an error payload.
        // Forward it straight back as the tool result (no CODAP round-trip) so the
        // tool_use is still answered and the model can recover in this same turn.
        if (isToolRequestError(data.request)) {
          self.addDbgMsg("Tool call could not be prepared", formatJsonMessage(data.request));
          return JSON.stringify(data.request);
        }

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
          message: {
            tool_call_id: toolCallId,
            content
          }
        };

        // Send tool output to the server
        const submissionResponse = yield postMessage(reqBody, "tool");
        if (!submissionResponse.ok) {
          throw new Error(`Failed to submit tool output: ${submissionResponse.statusText}`);
        }

        const { messageId } = yield submissionResponse.json();

        // Poll for the tool response
        let data: IMessageResponse | null = null;
        const deadlineMs = 60_000;
        const startedAt = performance.now();

        while (performance.now() - startedAt < deadlineMs) {
          if (self.isCancelling) break;

          const statusResponse = yield postMessage({}, `status?messageId=${messageId}`, "GET");
          if (!statusResponse.ok) {
            throw new Error(`Failed to fetch tool response status: ${statusResponse.statusText}`);
          }

          const { status, output } = yield statusResponse.json();

          if (status === "completed") {
            data = output;
            break;
          } else if (status === "cancelled") {
            self.addDbgMsg("Tool call job was cancelled on the server", messageId);
            return;
          } else if (status === "error") {
            self.addDbgMsg("Server error processing tool output", output?.error || "Unknown error");
            self.addDavaiMsg("Sorry, I ran into an error processing that request.");
            return;
          }

          yield new Promise((res) => setTimeout(res, 1000));
        }

        if (!data) {
          self.addDbgMsg("Polling expired before tool response received", messageId);
          return;
        }

        return data;
      } catch (err) {
        console.error("Failed to send tool output:", err);
        self.addDbgMsg("Failed to send tool output", formatJsonMessage(err));
        throw err;
      }
    });

    const handleMessageSubmit = flow(function* (messageText: string) {
      // Time from when real processing begins to when a terminal outcome is
      // reached. logResponseTime posts exactly one debug entry (it disarms
      // itself), and is called just before each terminal output so the entry
      // appears directly above the response in the transcript.
      let startTime: number | undefined;
      const logResponseTime = () => {
        if (startTime === undefined) return;
        const elapsed = formatElapsedTime(performance.now() - startTime);
        self.addDbgMsg(`Response time: ${elapsed}`, elapsed);
        startTime = undefined;
      };
      try {
        self.setShowLoadingIndicator(true);
        if (self.isCancelling || self.isResetting) {
          const description = self.isCancelling ? "Cancelling" : "Resetting";
          self.addDbgMsg(description, `User message added to queue: ${messageText}`);
          self.messageQueue.push(messageText);
        } else {
          startTime = performance.now();
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

          const submissionResponse = yield postMessage(reqBody, "message");
          if (!submissionResponse.ok) {
            throw new Error(`Failed to submit message: ${submissionResponse.statusText}`);
          }
          const { messageId: _messageId } = yield submissionResponse.json();
          self.currentMessageId = _messageId;

          // 2. Poll server until response is ready. No-progress budget (reset whenever
          // streamed bytes arrive) instead of a fixed attempt count, so long streams
          // aren't dropped mid-flight.
          let data: IMessageResponse | null = null;
          const idleBudgetMs = 60_000;
          let lastProgressAt = performance.now();
          let lastLen = 0;

          while (performance.now() - lastProgressAt < idleBudgetMs) {
            if (self.isCancelling) break;

            const statusResponse = yield postMessage({}, `status?messageId=${_messageId}`, "GET");
            if (!statusResponse.ok) {
              throw new Error(`Failed to fetch status: ${statusResponse.statusText}`);
            }
            const { status, output } = yield statusResponse.json();

            if (status === "completed") {
              data = output;
              break;
            } else if (status === "cancelled") {
              logResponseTime();
              self.finishStream();
              self.addDbgMsg("Job was cancelled on the server", messageId);
              return;
            } else if (status === "error") {
              logResponseTime();
              self.finishStream();
              self.addDbgMsg("Server error processing message", output?.error || "Unknown error");
              self.addDavaiMsg("Sorry, I ran into an error processing that request.");
              return;
            } else if (status === STREAMING_STATUS && self.streamEnabled && typeof output?.response === "string") {
              if (output.response.length > lastLen) {
                lastLen = output.response.length;
                lastProgressAt = performance.now(); // progress → extend the budget
              }
              self.ingestStreamChunk(output.response);
              yield new Promise((res) => setTimeout(res, 500)); // faster cadence while streaming
              continue;
            }

            yield new Promise((res) => setTimeout(res, 1000));
          }

          if (!data) {
            logResponseTime();
            self.finishStream();
            self.addDbgMsg("Polling expired before response received", messageId);
            return;
          }

          self.addDbgMsg("Response from server", formatJsonMessage(data));

          // Tool calls: a streamed message (if any) is discarded for this turn.
          while (data?.status === "requires_action" && data?.tool_call_id) {
            self.discardStream();
            const toolOutput = yield processToolCall(data as IToolCallData);
            self.addDbgMsg("Tool output generated", formatJsonMessage(toolOutput));
            const toolResponseResult: any = yield sendToolOutputToLlm(data.tool_call_id, toolOutput);
            self.addDbgMsg("Response to tool output from server", formatJsonMessage(toolResponseResult));
            data = toolResponseResult;
          }

          if (data?.response) {
            logResponseTime();
            self.finalizeStream(data.response);
          }
        }
      } catch (err) {
        // Log before the error message so the timing row sits above it, like the
        // other terminal branches. Disarms itself, so the finally call is a no-op.
        logResponseTime();
        console.error("Failed to handle message submit:", err);
        self.addDbgMsg("Failed to handle message submit", formatJsonMessage(err));
      } finally {
        self.isLoadingResponse = false;
        self.setShowLoadingIndicator(false);
        self.currentMessageId = null;
        // Backstop for a success that produced no chat output (tool-only end).
        // No-op if an inline call already logged (including the catch path).
        logResponseTime();
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
