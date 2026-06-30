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

// Post a timing debug entry (e.g. "Begin response time"/"Completed response time")
// measured from the user-submit start. No-op if no start time is recorded.
const timingDebug = (transcriptStore: any, label: string, startMs: number | null) => {
  if (startMs == null) return;
  transcriptStore.addMessage(DEBUG_SPEAKER, { description: label, content: formatElapsedTime(performance.now() - startMs) });
};

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
    responseStartTime: null as number | null,
  }))
  .views((self) => ({
    get isAssistantMocked() {
      const llmData = JSON.parse(self.llmId || "");
      return llmData.id === "mock";
    },
    // True whenever a response is being produced and the chat input should stay busy
    // (disabled, showing Cancel). isLoadingResponse spans the whole real-LLM turn
    // (including tool calls and streaming, after the "Processing" indicator is cleared);
    // showLoadingIndicator covers the mock assistant, which never sets isLoadingResponse.
    get isResponding() {
      return self.isLoadingResponse || self.showLoadingIndicator;
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
        self.showLoadingIndicator = false; // text has begun; hide the Processing indicator
        self.currentStreamingMessageId =
          self.transcriptStore.addStreamingMessage(DAVAI_SPEAKER, { content: "" });
        timingDebug(self.transcriptStore, "Begin response time", self.responseStartTime);
      }
      const id = self.currentStreamingMessageId;
      const msg = self.transcriptStore.messages.find((m) => m.id === id);
      const shown = msg?.messageContent.content ?? "";
      const added = appendedText(shown, cumulative);
      if (added) self.transcriptStore.appendToMessage(id, added);
    },
    finalizeStream(fullText: string) {
      if (self.currentStreamingMessageId) {
        // Streamed: finalize the existing message in place, then log completion after it.
        self.transcriptStore.finalizeStreamingMessage(self.currentStreamingMessageId, fullText);
        self.currentStreamingMessageId = null;
        timingDebug(self.transcriptStore, "Completed response time", self.responseStartTime);
      } else {
        // Non-streamed: the whole response arrives at once. Log the begin/completed pair
        // (streaming emits "Begin response time" on the first chunk; here begin == completed)
        // BEFORE adding the message, so the DAVAI message stays the LAST transcript row —
        // App's announce/speak effect for non-streamed responses keys off "last message is
        // a DAVAI message", and trailing debug rows would suppress it.
        timingDebug(self.transcriptStore, "Begin response time", self.responseStartTime);
        timingDebug(self.transcriptStore, "Completed response time", self.responseStartTime);
        self.transcriptStore.addMessage(DAVAI_SPEAKER, { content: fullText });
      }
    },
    // Finalize the in-progress streamed message in place, keeping its already-shown
    // text (used for cancel/error/timeout and for user-facing text that precedes a
    // follow-up tool call). Pass logCompleted=true when the text is a completed
    // user-facing message (so it gets a "Completed response time" entry).
    finishStream(logCompleted = false) {
      if (self.currentStreamingMessageId) {
        const msg = self.transcriptStore.messages.find((m) => m.id === self.currentStreamingMessageId);
        self.transcriptStore.finalizeStreamingMessage(self.currentStreamingMessageId, msg?.messageContent.content ?? "");
        if (logCompleted) timingDebug(self.transcriptStore, "Completed response time", self.responseStartTime);
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

        // Poll for the tool response. A tool result triggers the next model turn,
        // which produces user-facing text (e.g. a graph description) and ALSO streams,
        // so this loop must handle STREAMING_STATUS the same way the message loop does
        // (no-progress budget so a long streamed description isn't cut off).
        let data: IMessageResponse | null = null;
        const idleBudgetMs = 60_000;
        let lastProgressAt = performance.now();
        let lastLen = 0;

        while (performance.now() - lastProgressAt < idleBudgetMs) {
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
            self.finishStream();
            self.addDbgMsg("Tool call job was cancelled on the server", messageId);
            return;
          } else if (status === "error") {
            self.finishStream();
            self.addDbgMsg("Server error processing tool output", output?.error || "Unknown error");
            self.addDavaiMsg("Sorry, I ran into an error processing that request.");
            return;
          } else if (status === STREAMING_STATUS && typeof output?.response === "string") {
            // Count server streaming as progress regardless of the client's display
            // preference (same as the message loop), so a long tool-phase response isn't
            // dropped by the idle budget. Only the on-screen/spoken ingestion is gated.
            if (output.response.length > lastLen) {
              lastLen = output.response.length;
              lastProgressAt = performance.now();
            }
            if (self.streamEnabled) self.ingestStreamChunk(output.response);
            yield new Promise((res) => setTimeout(res, 500));
            continue;
          }

          yield new Promise((res) => setTimeout(res, 1000));
        }

        if (!data) {
          self.finishStream();
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
      // A response is already in flight: queue this message to send once the current turn
      // finishes, and bail out *before* the request lifecycle below. Its finally block
      // clears the in-flight flags (isLoadingResponse/currentMessageId), so running it for
      // a mere queue would prematurely tear down the live request; and starting a second
      // job here would overwrite currentMessageId and corrupt polling/cancellation.
      if (self.isLoadingResponse) {
        self.addDbgMsg("Processing", `User message added to queue: ${messageText}`);
        self.messageQueue.push(messageText);
        return;
      }
      try {
        self.setShowLoadingIndicator(true);
        if (self.isCancelling || self.isResetting) {
          const description = self.isCancelling ? "Cancelling" : "Resetting";
          self.addDbgMsg(description, `User message added to queue: ${messageText}`);
          self.messageQueue.push(messageText);
        } else {
          self.responseStartTime = performance.now();
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
              self.finishStream();
              self.addDbgMsg("Job was cancelled on the server", messageId);
              return;
            } else if (status === "error") {
              self.finishStream();
              self.addDbgMsg("Server error processing message", output?.error || "Unknown error");
              self.addDavaiMsg("Sorry, I ran into an error processing that request.");
              return;
            } else if (status === STREAMING_STATUS && typeof output?.response === "string") {
              // Count server streaming as progress regardless of the client's display
              // preference, so a long response can't hit the idle budget while the server
              // is steadily generating. Only the on-screen/spoken ingestion is gated on
              // streamEnabled.
              if (output.response.length > lastLen) {
                lastLen = output.response.length;
                lastProgressAt = performance.now(); // progress → extend the budget
              }
              if (self.streamEnabled) self.ingestStreamChunk(output.response);
              yield new Promise((res) => setTimeout(res, 500)); // faster cadence while streaming
              continue;
            }

            yield new Promise((res) => setTimeout(res, 1000));
          }

          if (!data) {
            self.finishStream();
            self.addDbgMsg("Polling expired before response received", messageId);
            return;
          }

          self.addDbgMsg("Response from server", formatJsonMessage(data));

          // Tool calls: any user-facing text the model emitted before this tool call is
          // kept and counted as a completed response, not discarded. The server attaches
          // that text as `response` on the tool-call payload, so finalize it here — this
          // captures it even when streaming display is off or we never polled a transient
          // streaming update (finalizeStream finalizes an in-progress streamed message in
          // place, or adds + announces it when nothing was streamed). With no pre-tool
          // text, just close out any partial stream.
          while (data?.status === "requires_action" && data?.tool_call_id) {
            if (typeof data.response === "string" && data.response.trim()) {
              self.finalizeStream(data.response);
            } else {
              self.finishStream(true);
            }
            self.setShowLoadingIndicator(true); // re-show "Processing" for this tool phase
            const toolOutput = yield processToolCall(data as IToolCallData);
            self.addDbgMsg("Tool output generated", formatJsonMessage(toolOutput));
            const toolResponseResult: any = yield sendToolOutputToLlm(data.tool_call_id, toolOutput);
            self.addDbgMsg("Response to tool output from server", formatJsonMessage(toolResponseResult));
            data = toolResponseResult;
          }

          if (data?.response) {
            self.finalizeStream(data.response);
          }
        }
      } catch (err) {
        // Finalize any in-progress streamed message (keeping its shown text) so an
        // exception can't leave it stuck isStreaming, which would wedge the a11y
        // streaming logic and autoscroll on the next turn.
        self.finishStream();
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
