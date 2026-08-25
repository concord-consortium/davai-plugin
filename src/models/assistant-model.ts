import { types, flow, Instance, getRoot, onSnapshot } from "mobx-state-tree";
import { nanoid } from "nanoid";
import { codapInterface } from "@concord-consortium/codap-plugin-api";
import { DAVAI_SPEAKER, DEBUG_SPEAKER, STREAMING_STATUS, USER_SPEAKER, WEBGPU_UNAVAILABLE_MESSAGE } from "../constants";
import { appendedText } from "../utils/stream-utils";
import { formatJsonMessage, formatElapsedTime } from "../utils/utils";
import { getDataContexts, getGraphAttrData, getGraphByID, getTrimmedGraphDetails, sendCODAPRequest } from "../utils/codap-api-utils";
import { isGraphSonifiable } from "../utils/graph-sonification-utils";
import { ChatTranscriptModel } from "./chat-transcript-model";
import { IToolCallData, IToolRequestError, IMessageResponse, ToolOutput } from "../types";
import { postMessage } from "../utils/llm-utils";
import { WsTransport, SeedMessage } from "../utils/ws-transport";
import { getAgentCoreConnectUrl } from "../utils/agentcore-auth";
import { getAgentCoreConfig } from "../utils/agentcore-config";
import { localLlmService } from "../utils/local-llm/local-llm-service";
import { runLocalTurn } from "../utils/local-llm/local-llm-loop";
import { buildLocalSystemPrompt, buildTranscriptTurns } from "../utils/local-llm/local-llm-prompt";
import { initializeLocalTools, dispatchTool, buildToolDocs, ILocalToolContext } from "../utils/local-llm/tools";
import { buildGraphSeed, buildSchemaDigest, deriveCurrentGraphId } from "../utils/local-llm/local-llm-prefetch";
import { runLocalEval, summarizeEval, IEvalTurnResult } from "../utils/local-llm/eval/eval-runner";
import { IEvalCase } from "../utils/local-llm/eval/eval-cases";
import { IUsage, costForUsage, PRICES_AS_OF } from "../utils/model-pricing";

// Registers the curated local-tool set once per module load. Idempotent (registerTools does a
// wholesale array reassignment), so re-import / hot-reload / multiple AssistantModel instances
// never double-register or leak stale tool objects.
initializeLocalTools();

// A tool call the server could not prepare comes back as an error payload rather
// than a normal CODAP request. This guard narrows the union so the normal path can
// safely use action/resource/etc.
const isToolRequestError = (request: IToolCallData["request"]): request is IToolRequestError =>
  "status" in request && request.status === "error";

// Best-effort transcript -> seed messages for WebSocket idle re-seed (after a
// microVM recycle). Only user/assistant text is replayed; debug entries are skipped.
const buildReseedMessages = (transcriptStore: any): SeedMessage[] => {
  const msgs = transcriptStore?.messages ?? [];
  const out: SeedMessage[] = [];
  for (const m of msgs) {
    const content = m?.messageContent?.content;
    if (typeof content !== "string" || !content.trim()) continue;
    if (m.speaker === DEBUG_SPEAKER) continue;
    // Status chatter (WebGPU notices, cancel confirmations, model-load progress) is
    // kept out of the model conversation everywhere else; keep it out of seeds too.
    if (m?.messageContent?.kind === "announcement") continue;
    out.push({ role: m.speaker === DAVAI_SPEAKER ? "assistant" : "user", content });
  }
  return out;
};

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
    effort: "" as string,
    // WebSocket transport. On when a direct endpoint is configured (WS_SERVER_URL:
    // local container or dev bridge) or when the build targets the deployed AgentCore
    // stack (TRANSPORT=agentcore — webpack's default; unset under Jest, so tests keep
    // exercising the poll path). TRANSPORT=poll restores the legacy SAM path.
    useWebSocket: (!!process.env.WS_SERVER_URL || process.env.TRANSPORT === "agentcore") as boolean,
    wsTransport: null as WsTransport | null,
    wsTransportThreadId: null as string | null,
    // Monotonic counter guarding in-flight LOCAL turns. A local turn captures this at start;
    // cancel, a model switch (setLlmId), and createThread all bump it. When the suspended
    // `yield runLocalTurn(...)` resumes, a mismatch means the turn was cancelled/superseded, so
    // its reply, error message, and flag/queue writes are all skipped (no zombie turn).
    turnEpoch: 0 as number,
    // Per-model token/cost accumulation for the whole plugin session (survives
    // New Thread; the display is a session meter, not a thread meter).
    sessionUsage: {} as Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number; turns: number }>,
  }))
  .views((self) => ({
    get isAssistantMocked() {
      const llmData = JSON.parse(self.llmId || "");
      return llmData.id === "mock";
    },
    get isLocalLlm() {
      try {
        return JSON.parse(self.llmId || "").provider === "Local";
      } catch {
        return false;
      }
    },
    // True whenever a response is being produced and the chat input should stay busy
    // (disabled, showing Cancel). isLoadingResponse spans the whole real-LLM turn
    // (including tool calls and streaming, after the "Processing" indicator is cleared);
    // showLoadingIndicator covers the mock assistant, which never sets isLoadingResponse.
    get isResponding() {
      return self.isLoadingResponse || self.showLoadingIndicator;
    },
    get sessionCostSummary() {
      const models = Object.entries(self.sessionUsage).map(([model, agg]) => {
        const cost = costForUsage(model, {
          input_tokens: agg.input, output_tokens: agg.output,
          input_token_details: { cache_read: agg.cacheRead, cache_creation: agg.cacheWrite },
        });
        return { model, ...agg, inputCost: cost?.inputCost, outputCost: cost?.outputCost, totalCost: cost?.totalCost };
      });
      const totals = models.reduce((t, m) => ({
        input: t.input + m.input,
        output: t.output + m.output,
        totalCost: m.totalCost === undefined ? t.totalCost : (t.totalCost ?? 0) + m.totalCost,
      }), { input: 0, output: 0, totalCost: undefined as number | undefined });
      return { asOf: PRICES_AS_OF, models, totals };
    }
  }))
  .actions((self) => ({
    addDavaiMsg(msg: string) {
      self.transcriptStore.addMessage(DAVAI_SPEAKER, { content: msg });
    },
    // Status chatter (WebGPU notice, cancel confirmation, local-model error) that should be
    // shown/announced but kept out of the model conversation history (buildTranscriptTurns
    // filters kind === "announcement").
    addDavaiAnnouncement(msg: string) {
      self.transcriptStore.addMessage(DAVAI_SPEAKER, { content: msg, kind: "announcement" });
    },
    addDbgMsg (description: string, content: any) {
      self.transcriptStore.addMessage(DEBUG_SPEAKER, { description, content });
    },
    // Record one server round-trip's provider-reported usage. llmIdJson is the
    // llmId the REQUEST was sent with — attribution must not re-read self.llmId,
    // or a model switch while a turn is in flight books the old model's tokens
    // under the new one. Undefined usage = provider/path reports none — no-op.
    recordUsage(usage?: IUsage, llmIdJson?: string) {
      if (!usage || typeof usage.input_tokens !== "number") return;
      let id = "unknown";
      try { id = JSON.parse(llmIdJson ?? self.llmId).id; } catch { /* keep "unknown" */ }
      const agg = self.sessionUsage[id] ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, turns: 0 };
      agg.input += usage.input_tokens;
      agg.output += usage.output_tokens ?? 0;
      agg.cacheRead += usage.input_token_details?.cache_read ?? 0;
      agg.cacheWrite += usage.input_token_details?.cache_creation ?? 0;
      agg.turns += 1;
      self.sessionUsage = { ...self.sessionUsage, [id]: agg };
      const cost = costForUsage(id, {
        ...usage,
        input_tokens: usage.input_tokens ?? 0,
        output_tokens: usage.output_tokens ?? 0,
      });
      self.transcriptStore.addMessage(DEBUG_SPEAKER, {
        description: "Token usage",
        content: formatJsonMessage({ model: id, ...usage, ...(cost ? { estCost: cost.totalCost } : {}) }),
      });
    },
    setShowLoadingIndicator(show: boolean) {
      self.showLoadingIndicator = show;
    },
    setLlmId(llmId: string) {
      // A model switch invalidates any in-flight local turn: bump the epoch so a turn started
      // under the previous model can't post its reply into the new model's conversation. Unlike
      // a stale turn superseded by a NEWER turn (whose own finally will eventually clear the
      // flags), a switch has no newer turn coming — so nothing else will ever clear
      // isLoadingResponse/showLoadingIndicator, permanently disabling the chat input. Clear them
      // here too, and drop any queued messages (their context is the transcript this switch just
      // reset), mirroring handleCancel's local-turn branch. Written as direct property/array
      // writes rather than via setShowLoadingIndicator/clearUserMessageQueue: those wrapper
      // actions are defined in LATER `.actions()` blocks, which MST's type inference doesn't
      // expose on `self` within this (earlier) block, even though same-block sibling calls
      // would work fine at runtime.
      if (llmId !== self.llmId) {
        self.turnEpoch++;
        self.isLoadingResponse = false;
        self.showLoadingIndicator = false;
        self.messageQueue.clear();
      }
      self.llmId = llmId;
    },
    bumpTurnEpoch() {
      self.turnEpoch++;
    },
    setThreadId(threadId: string) {
      self.threadId = threadId;
    },
    setStreamEnabled(enabled: boolean) {
      self.streamEnabled = enabled;
    },
    setEffort(effort: string) {
      self.effort = effort;
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

          // When the request is to create a graph component, refresh the graph stores
          // ourselves: as of CODAP 3.1 component notifications are NOT echoed back to the
          // plugin that initiated the change, so nothing else will. The resource may be the
          // bare "component" or the dataContext-scoped "dataContext[...].component" form —
          // the LLM emits both and CODAP accepts both. Refresh BOTH stores (assistant graph
          // context + sonification menu), mirroring the local path's refreshGraphs (its
          // toolCtx blocks in handleMessageSubmitLocalLlm and runLocalEvalTurns).
          if (action === "create" && /(^|\.)component$/.test(resource) && values?.type === "graph") {
            const root = getRoot(self) as any;
            yield updateGraphs();
            yield root.sonificationStore.setGraphs({ selectNewest: true });
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

    const setUseWebSocket = (enabled: boolean) => {
      self.useWebSocket = enabled;
    };

    // Lazily create (and re-pin on threadId change) the session-pinned WebSocket
    // transport.
    const ensureTransport = (): WsTransport => {
      if (!self.wsTransport || self.wsTransportThreadId !== self.threadId) {
        self.wsTransport?.close();
        const wsUrl = process.env.WS_SERVER_URL;
        self.wsTransport = new WsTransport(wsUrl
          ? {
              // Direct endpoint: local backend container or the dev SigV4 bridge.
              url: wsUrl,
              authToken: process.env.AUTH_TOKEN || undefined,
              onReconnect: () => buildReseedMessages(self.transcriptStore),
            }
          : {
              // Deployed AgentCore runtime: Cognito temp credentials -> SigV4
              // presigned URL per (re)connect. Staging vs production is resolved
              // from the build's DEPLOY_PATH (see agentcore-config.ts).
              getConnectUrl: (sessionId) => getAgentCoreConnectUrl(getAgentCoreConfig(), sessionId),
              onReconnect: () => buildReseedMessages(self.transcriptStore),
            });
        self.wsTransportThreadId = self.threadId ?? null;
      }
      return self.wsTransport;
    };

    // Run one turn over the WebSocket, mapping streamed tokens to the same
    // ingestStreamChunk the poll path uses. Returns the terminal output (identical
    // shape to the poll path's `data`).
    const wsRunTurn = flow(function* (input: any) {
      const transport = ensureTransport();
      const output = yield transport.runTurn(input, {
        onToken: (text: string) => {
          if (self.streamEnabled) self.ingestStreamChunk(text);
        },
      });
      return output;
    });

    const sendToolOutputToLlm = flow(function* (toolCallId: string, content: ToolOutput) {
      if (self.isAssistantMocked) return;

      try {
        const reqBody = {
          llmId: self.llmId,
          threadId: self.threadId,
          effort: self.effort,
          message: {
            tool_call_id: toolCallId,
            content
          }
        };

        // WebSocket: return the tool result over the same socket — no second job, no poll.
        if (self.useWebSocket) {
          const wsOut = yield wsRunTurn({ ...reqBody, kind: "tool" });
          // Second disjunct: handleCancel latched the turn dead while this tool round
          // was in flight (see handleCancel's WS branch) — discard the late result.
          if (wsOut?.status === "cancelled" || self.currentMessageId === null) {
            self.finishStream();
            self.addDbgMsg("Tool call job was cancelled", toolCallId);
            return;
          }
          // Record here (not in the caller) so the tokens are attributed to the
          // llmId THIS tool round was sent with, even across a mid-turn model switch.
          (self as any).recordUsage(wsOut?.usage, reqBody.llmId);
          return wsOut;
        }

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

        // Same attribution rule as the WS branch above.
        (self as any).recordUsage(data?.usage, reqBody.llmId);
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
            effort: self.effort,
            dataContexts: self.dataContexts,
            graphs: self.graphs,
            message: messageText,
            isSystemMessage: false,
            messageId
          };

          let data: IMessageResponse | null = null;

          if (self.useWebSocket) {
            const wsOut = yield wsRunTurn({ ...reqBody, kind: "message" });
            // Discard cancelled turns whether the server converted them (status:
            // "cancelled") or the cancel lost the race and a real result arrived after
            // handleCancel latched the turn dead (currentMessageId no longer ours).
            if (wsOut?.status === "cancelled" || self.currentMessageId !== messageId) {
              self.finishStream();
              self.addDbgMsg("Discarding result of cancelled turn", messageId);
              return;
            }
            data = wsOut;
          } else {
          const submissionResponse = yield postMessage(reqBody, "message");
          if (!submissionResponse.ok) {
            throw new Error(`Failed to submit message: ${submissionResponse.statusText}`);
          }
          const { messageId: _messageId } = yield submissionResponse.json();
          self.currentMessageId = _messageId;

          // 2. Poll server until response is ready. No-progress budget (reset whenever
          // streamed bytes arrive) instead of a fixed attempt count, so long streams
          // aren't dropped mid-flight.
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
          }

          (self as any).recordUsage(data?.usage, reqBody.llmId);
          self.addDbgMsg("Response from server", formatJsonMessage(data));

          // Tool calls: any user-facing text the model emitted before this tool call is
          // kept and counted as a completed response, not discarded. The server attaches
          // that text as `response` on the tool-call payload, so finalize it here — this
          // captures it even when streaming display is off or we never polled a transient
          // streaming update (finalizeStream finalizes an in-progress streamed message in
          // place, or adds + announces it when nothing was streamed). With no pre-tool
          // text, just close out any partial stream.
          while (data?.status === "requires_action" && data?.tool_call_id) {
            // Cancel landed during a tool round: stop before executing the CODAP action.
            if (self.useWebSocket && self.currentMessageId !== messageId) {
              self.finishStream();
              self.addDbgMsg("Discarding tool call of cancelled turn", messageId);
              return;
            }
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

    // Local-model counterpart to handleMessageSubmit: runs the whole turn (including any
    // tool rounds) in-browser via runLocalTurn, with no server round-trip. handleMessageSubmit
    // delegates its own queue draining to the afterCreate/onSnapshot reactor below, but that
    // reactor is hardcoded to call handleMessageSubmit — routing a queued local message through
    // it would send it to the server. So this flow drains its own queue (one message at a time,
    // recursing into itself) instead of relying on the shared reactor; the empirical MST timing
    // (self.isLoadingResponse = false does not synchronously trigger the onSnapshot reaction
    // before this finally block finishes) means the shared reactor never sees a non-empty queue
    // to double-drain.
    const handleMessageSubmitLocalLlm = flow(function* (messageText: string) {
      // Same in-flight discipline as handleMessageSubmit: queue instead of overlapping.
      if (self.isLoadingResponse) {
        self.addDbgMsg("Processing", `User message added to queue: ${messageText}`);
        self.messageQueue.push(messageText);
        return;
      }
      // Capture the turn epoch. Cancel / model switch / createThread bump self.turnEpoch; if it
      // changes while this flow is suspended at a `yield`, the turn has been superseded and must
      // become a no-op on resume (no reply, no error, no flag/queue writes). `self.turnEpoch` is
      // always re-read live here because MST flows resume against the current model state.
      const myEpoch = self.turnEpoch;
      const isCurrent = () => self.turnEpoch === myEpoch;
      try {
        self.setShowLoadingIndicator(true);
        self.isLoadingResponse = true;
        // The timer starts here, but the Begin/Completed pair is posted together at COMPLETION
        // (see below): timingDebug reports the ELAPSED time from responseStartTime, so a Begin
        // posted at this same instant would always read 0. The local turn is single-shot (no
        // streaming "first chunk" moment), so begin == completed — the same convention as
        // finalizeStream's non-streamed branch on the server path.
        self.responseStartTime = performance.now();

        if (!localLlmService.isWebGPUAvailable()) {
          self.addDavaiAnnouncement(WEBGPU_UNAVAILABLE_MESSAGE);
          return;
        }

        const { id } = JSON.parse(self.llmId);
        // Idempotent: resolves immediately if the engine for this model is already loaded.
        yield localLlmService.loadEngine(id);
        if (!isCurrent()) return; // cancelled/superseded during the (possibly long) load

        // Transcript turns are the history BEFORE this message. On a direct submit, App added
        // the user row immediately before dispatch, so that row IS this message and must be
        // excluded. On a finally-drained queue turn, the queued user row was likewise added by
        // App at submit time, but it sits BEFORE the prior turn's DAVAI reply (which is now the
        // trailing row) — so a trailing-only check misses it, leaving it in `turns` AND
        // duplicated as `userMessage` below. Remove the LAST occurrence (scanning from the end)
        // of a USER_SPEAKER row whose content matches messageText, wherever it sits, keeping
        // everything else — including any earlier legitimate identical question — in order.
        const msgs = self.transcriptStore.messages;
        const lastMatchIndex = (() => {
          for (let i = msgs.length - 1; i >= 0; i--) {
            const m = msgs[i];
            if (m.speaker === USER_SPEAKER && m.messageContent.content === messageText) return i;
          }
          return -1;
        })();
        const priorMessages =
          lastMatchIndex === -1
            ? msgs.slice()
            : [...msgs.slice(0, lastMatchIndex), ...msgs.slice(lastMatchIndex + 1)];

        // ILocalToolContext carries only plain utilities and REGISTERED actions
        // (updateDataContexts/updateGraphs/setSelectedGraphID), never a bare flow closure: tool
        // executors run from runLocalTurn's async continuation, outside any MST action context,
        // and a bare flow() call there throws "a mst flow must always have a parent context".
        // Routing through registered actions (via self / root store) self-roots a new context.
        const root = getRoot(self) as any;
        const toolCtx: ILocalToolContext = {
          sendCODAPRequest,
          dataContexts: () => self.dataContexts ?? {},
          graphs: () => self.graphs ?? [],
          // The store's explicit selection wins; a single-graph document falls back to that
          // graph, since clicking a graph in CODAP never sets the store's selection (only
          // auto-select-on-create/titleChange and the Sonification panel's menu do) — see
          // deriveCurrentGraphId.
          selectedGraphId: () => deriveCurrentGraphId(root.sonificationStore?.selectedGraphID, self.graphs ?? []),
          setSelectedGraphID: (graphId) => root.sonificationStore.setSelectedGraphID(graphId),
          // Cast to `any`: same-block sibling-action reference (see the `processToolCall`
          // executeTool comment above) — TS doesn't see updateDataContexts/updateGraphs on
          // `self` until this same `.actions()` block's `return` adds them to the live instance.
          refreshDataContexts: async () => { await (self as any).updateDataContexts(); },
          // Two separate stores, both needing a refresh after create_graph: updateGraphs refills
          // the assistant's own graph list (self.graphs, used above for name resolution), while
          // setGraphs({ selectNewest: true }) is the sonification store's registered flow that
          // makes the newly created graph auto-selected — the same auto-select the server path
          // gets from the processToolCall guard above. Without this second call the local path's
          // graph creation would succeed but the Sonification menu would never pick up the new
          // graph. setGraphs is a registered flow on another node, so — like setSelectedGraphID
          // above — it's safely callable from this async continuation.
          refreshGraphs: async () => {
            await (self as any).updateGraphs();
            await root.sonificationStore.setGraphs({ selectNewest: true });
          },
          // update_graph mutates an EXISTING graph, so there is no "newest" graph to select —
          // refreshGraphs's setGraphs({ selectNewest: true }) call above would be a no-op in that
          // case (setGraphs only reassigns selection when it finds a graph id NOT already in its
          // snapshot), but relying on that being a no-op is fragile. This bare refill (no
          // selectNewest follow-up at all) is the honest "just refresh the list" primitive for
          // tools that must never disturb the current sonification selection.
          refreshGraphList: async () => { await (self as any).updateGraphs(); },
        };
        // Reuses the existing effort machinery as the thinking toggle: effort "think" turns
        // Qwen3 thinking on (via the /think prompt switch) and doubles the completion-token
        // budget below (thinking consumes completion tokens; the default 1024 would truncate
        // mid-think). Any other effort value (including "" / "none") keeps the /no_think
        // behavior and the 1024 budget.
        const thinking = self.effort === "think";
        const selectedId = toolCtx.selectedGraphId();
        const graphSeed: string = selectedId ? yield buildGraphSeed(String(selectedId), self.dataContexts ?? {}) : "";
        const systemPrompt = buildLocalSystemPrompt({
          toolDocs: buildToolDocs(),
          schemaDigest: buildSchemaDigest(self.dataContexts ?? {}),
          graphSeed,
          thinking,
        });
        const response: string = yield runLocalTurn({
          generate: (messages) => localLlmService.generate(messages, { maxTokens: thinking ? 2048 : 1024 }),
          executeTool: (name, args) => dispatchTool(name, args, toolCtx),
          systemPrompt,
          turns: buildTranscriptTurns(priorMessages),
          userMessage: messageText,
          // Stops the loop between generations once this turn is no longer current, so a
          // cancelled turn can't keep issuing generations or tool calls.
          isCancelled: () => !isCurrent(),
        });
        // The turn may have been cancelled/superseded while runLocalTurn was running; if so,
        // discard its (abandoned) result rather than posting a zombie reply.
        if (!isCurrent()) return;
        // The Begin/Completed pair posts together here (begin == completed for a non-streamed
        // turn — see the responseStartTime comment above), BEFORE the reply, mirroring
        // finalizeStream's non-streamed ordering on the server path: the debug rows must not
        // trail the DAVAI message, or it would break App's announce/speak effect, which keys
        // off "last message is a DAVAI message".
        timingDebug(self.transcriptStore, "Begin response time", self.responseStartTime);
        timingDebug(self.transcriptStore, "Completed response time", self.responseStartTime);
        self.addDavaiMsg(response);
      } catch (err) {
        // A cancelled turn's rejection is expected fallout of interrupt(); don't surface an
        // error zombie for it (and don't log a stale turn's elapsed time either).
        if (!isCurrent()) return;
        // The elapsed-to-failure is still the answer to "how long did it take". Posted as the
        // same Begin/Completed pair as the success path (begin == completed), before the
        // announcement for the same last-message-stays-DAVAI reason.
        timingDebug(self.transcriptStore, "Begin response time", self.responseStartTime);
        timingDebug(self.transcriptStore, "Completed response time", self.responseStartTime);
        console.error("Local model turn failed:", err);
        self.addDbgMsg("Local model turn failed", formatJsonMessage(err));
        self.addDavaiAnnouncement("Sorry, I ran into an error running the local model on that request.");
      } finally {
        // Only tear down / drain if this is still the current turn. A stale turn resuming after
        // cancel must NOT clear a fresh turn's isLoadingResponse or drain the queue (cancel
        // already cleared the flags and the queue).
        if (isCurrent()) {
          self.isLoadingResponse = false;
          self.setShowLoadingIndicator(false);
          if (self.messageQueue.length > 0) {
            const nextMessage = self.messageQueue.shift();
            if (nextMessage) handleMessageSubmitLocalLlm(nextMessage);
          }
        }
      }
    });

    // Scripted eval harness: runs a fixed battery of prompts against the SAME local-model building
    // blocks as handleMessageSubmitLocalLlm (engine ensure, tool ctx, graph seed, system prompt,
    // runLocalTurn) but as independent single-shot turns — no shared conversation, and no per-case
    // transcript chatter. Only a start announcement and the final pass/fail summary are added to
    // the transcript; the full per-case detail goes to the console (see summarizeEval's "details
    // in the browser console"). Reuses the same turnEpoch guard as a normal local turn, so Cancel
    // aborts an in-progress eval run the same way. Also mirrors handleMessageSubmitLocalLlm's
    // overlap/busy-flag/try-catch discipline: isLoadingResponse/showLoadingIndicator gate the run
    // against a concurrent chat turn or a second eval, and the whole body is wrapped so a failure
    // announces and resolves instead of leaving an unhandled rejection or a stuck busy chat input.
    const runLocalEvalTurns = flow(function* (cases: IEvalCase[]) {
      if (self.isLoadingResponse) {
        self.addDavaiAnnouncement(
          "A response or eval run is already in progress — wait for it to finish (or press Cancel) before starting the eval."
        );
        return;
      }
      // Fixture guard: the battery's fixed prompts (e.g. describe-graph's zero-tool expectation)
      // are only meaningful against the documented fixture — the Mammals sample with a Height dot
      // plot selected. Running the battery without a resolvable current graph produces failures
      // that are really "wrong fixture," not "the model got it wrong," so bail out before doing
      // any work (no engine load, no flags set). Uses the same deriveCurrentGraphId fallback as
      // the rest of the local path: a document with exactly one graph passes even with no
      // explicit sonification-store selection, since clicking a graph in CODAP never sets that
      // selection.
      const root = getRoot(self) as any;
      if (deriveCurrentGraphId(root.sonificationStore?.selectedGraphID, self.graphs ?? []) == null) {
        self.addDavaiAnnouncement(
          "Select a graph before running the eval — pick it in the Sonification section's graph menu " +
          "(fixture: Mammals sample with a Height dot plot selected)."
        );
        return;
      }
      const myEpoch = self.turnEpoch;
      const isCurrent = () => self.turnEpoch === myEpoch;
      try {
        self.isLoadingResponse = true;
        self.setShowLoadingIndicator(true);

        yield localLlmService.loadEngine(JSON.parse(self.llmId).id);
        if (!isCurrent()) return;

        self.addDavaiAnnouncement(`Running ${cases.length} local eval case${cases.length === 1 ? "" : "s"}…`);

        const toolCtx: ILocalToolContext = {
          sendCODAPRequest,
          dataContexts: () => self.dataContexts ?? {},
          graphs: () => self.graphs ?? [],
          selectedGraphId: () => deriveCurrentGraphId(root.sonificationStore?.selectedGraphID, self.graphs ?? []),
          setSelectedGraphID: (graphId) => root.sonificationStore.setSelectedGraphID(graphId),
          refreshDataContexts: async () => { await (self as any).updateDataContexts(); },
          // Same dual-store refresh as handleMessageSubmitLocalLlm's toolCtx (see its comment):
          // updateGraphs refills self.graphs, and setGraphs({ selectNewest: true }) is what makes
          // the Sonification menu auto-select a graph created via create_graph during an eval run.
          refreshGraphs: async () => {
            await (self as any).updateGraphs();
            await root.sonificationStore.setGraphs({ selectNewest: true });
          },
          // Same no-selectNewest refill as handleMessageSubmitLocalLlm's toolCtx (see its comment)
          // — used by update_graph so an eval run mutating an existing graph never disturbs
          // selection the way create_graph's auto-select intentionally does.
          refreshGraphList: async () => { await (self as any).updateGraphs(); },
        };
        // Same thinking wiring as handleMessageSubmitLocalLlm (see its comment): effort "think"
        // enables the /think prompt switch and doubles the completion-token budget.
        const thinking = self.effort === "think";
        const selectedId = toolCtx.selectedGraphId();
        const graphSeed: string = selectedId ? yield buildGraphSeed(String(selectedId), self.dataContexts ?? {}) : "";
        const systemPrompt = buildLocalSystemPrompt({
          toolDocs: buildToolDocs(),
          schemaDigest: buildSchemaDigest(self.dataContexts ?? {}),
          graphSeed,
          thinking,
        });

        const runTurn = async (prompt: string): Promise<IEvalTurnResult> => {
          const toolCalls: string[] = [];
          // Wrap executeTool (the eval's OWN wiring) to record each result string as it returns,
          // in call order. Deliberately not a change to runLocalTurn's onToolCall contract (that
          // hook only ever reported the name) — a rejected/errored tool call never resolves, so a
          // truly failing call is simply absent here rather than recorded with a placeholder, and
          // whatever succeeded before the turn later throws stays recorded.
          const toolResults: string[] = [];
          try {
            const final = await runLocalTurn({
              generate: (messages) => localLlmService.generate(messages, { maxTokens: thinking ? 2048 : 1024 }),
              executeTool: async (name, args) => {
                const result = await dispatchTool(name, args, toolCtx);
                toolResults.push(result);
                return result;
              },
              systemPrompt,
              turns: [], // eval cases are independent single-shot prompts, not a growing conversation
              userMessage: prompt,
              onToolCall: (name) => toolCalls.push(name),
              isCancelled: () => !isCurrent(),
            });
            return { toolCalls, toolResults, final };
          } catch (err) {
            // runLocalEval's own catch (eval-runner.ts) only sees this rejection's message —
            // attach what was recorded so far so the case's toolResults trace isn't silently
            // dropped just because the turn errored partway through.
            if (err instanceof Error) (err as Error & { toolResults?: string[] }).toolResults = toolResults;
            throw err;
          }
        };

        // Per-case incremental console output: MST axis-death spam and insertBefore errors
        // interleave with the battery, and the user cannot attribute them to a case without a
        // BEFORE/AFTER marker per case. The pure runner (eval-runner.ts) stays console-free;
        // these callbacks are the ONLY place the actual console.log calls live.
        const results = yield runLocalEval(
          cases, runTurn, undefined,
          // eslint-disable-next-line no-console
          (start) => console.log(`DAVAI eval case ${start.index}/${start.total}: ${start.id} — ${start.prompt}`),
          // eslint-disable-next-line no-console
          (result) => console.log("DAVAI eval result", JSON.stringify(result))
        );
        if (!isCurrent()) return; // cancelled/superseded partway through the battery

        // eslint-disable-next-line no-console
        console.log("DAVAI local eval results", JSON.stringify(results, null, 2));
        self.addDavaiAnnouncement(summarizeEval(results));
      } catch (err) {
        if (!isCurrent()) return;
        console.error("Local eval failed:", err);
        self.addDavaiAnnouncement(`Local eval failed: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        if (isCurrent()) {
          self.isLoadingResponse = false;
          self.setShowLoadingIndicator(false);
          if (self.messageQueue.length > 0) {
            const nextMessage = self.messageQueue.shift();
            if (nextMessage) handleMessageSubmitLocalLlm(nextMessage);
          }
        }
      }
    });

    const handleCancel = flow(function* () {
      try {
        if (self.isLocalLlm) {
          localLlmService.interrupt();
          // Invalidate the in-flight turn: its suspended flow will see the epoch change on
          // resume and skip posting a reply / clearing the (soon-to-be-fresh) loading flag.
          self.bumpTurnEpoch();
          self.isLoadingResponse = false;
          self.setShowLoadingIndicator(false);
          // Drop any queued follow-ups too: handleMessageSubmitLocalLlm drains its own queue
          // in its finally block (so it never routes a queued local message through the
          // shared afterCreate/onSnapshot reactor below, which is hardcoded to the server's
          // handleMessageSubmit). But cancelling here bypasses that finally entirely, so a
          // non-empty queue would otherwise fall through to that shared reactor and leak
          // onto the server path the moment isLoadingResponse flips to false.
          self.clearUserMessageQueue();
          self.addDavaiAnnouncement("I've cancelled processing your message.");
          return;
        }
        if (self.currentMessageId && self.threadId) {
          self.isCancelling = true;
          self.setShowLoadingIndicator(false);

          self.addDavaiMsg("I've cancelled processing your message.");

          // WebSocket: the AgentCore backend has no HTTP cancel endpoint — cancellation is
          // a frame on the live socket, which aborts the in-flight turn server-side. The
          // abort races the result frame though (it is only checked between stream chunks,
          // and both frames cross the AgentCore hop), so ALSO latch the cancel client-side:
          // nulling currentMessageId marks the in-flight turn dead, and the submit flows
          // discard whatever its suspended wsRunTurn later resolves with — a late real
          // result must not be rendered or have its tool call executed.
          // (finally below still clears isCancelling.)
          if (self.useWebSocket) {
            const cancelledId = self.currentMessageId;
            self.wsTransport?.cancel();
            self.currentMessageId = null;
            self.addDbgMsg("Cancel request sent over WebSocket", cancelledId);
            return;
          }

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
        // Invalidate any in-flight LOCAL turn too (which has no currentMessageId to gate the
        // branch above): a reset thread must not receive a prior turn's late reply. Also drop
        // any queued local message (mirrors handleCancel's local branch and setLlmId):
        // handleMessageSubmitLocalLlm drains messageQueue itself in its own `finally` block so a
        // queued local message is never routed through the shared afterCreate/onSnapshot reactor
        // below (hardcoded to the server's handleMessageSubmit) — but createThread bypasses that
        // `finally` entirely, so an uncleared queue would otherwise fall through to that reactor
        // the moment isLoadingResponse flips to false and leak the message to the SERVER path.
        self.bumpTurnEpoch();
        self.isLoadingResponse = false;
        self.isCancelling = false;
        self.clearUserMessageQueue();
        self.threadId = nanoid();
      } catch (err) {
        console.error("Error creating thread:", err);
      }
    });

    return {
      createThread, initializeAssistant, handleMessageSubmit, handleMessageSubmitLocalLlm,
      handleCancel, updateDataContexts, updateGraphs, processToolCall, runLocalEvalTurns,
      setUseWebSocket
    };
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
