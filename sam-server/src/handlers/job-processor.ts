import { HumanMessage, ToolMessage } from "@langchain/core/messages";
import { getLangApp } from "../utils/llm-utils";
import { buildToolRepairMessages, extractToolCalls, toolCallResponse } from "../utils/tool-utils";
import { messageTextToString, shouldFlush, isAbortError, withAccumulatedResponse } from "../utils/stream-utils";
import { ToolJob, MessageJob } from "../types";
import { getLangSmithKey } from "../utils/env-utils";
import {
  clearRunning,
  getJob,
  registerRunning,
  writeCancelled,
  writeCompleted,
  writeError,
  writeStreaming,
} from "../agentcore/job-store";

const buildResponse = async (message: any) => {
  const toolCalls = extractToolCalls(message);
  if (toolCalls?.[0]) {
    return await toolCallResponse(toolCalls[0]);
  }
  // Coerce to a string: app.stream's assembled final message can carry an
  // Anthropic content-block array, which the client renders via react-markdown
  // (string-only). Mirrors the streaming partials, which already coerce.
  return { response: messageTextToString(message.content) };
};

// Set LangSmith API key for LangChain integration if available. When set, data
// about DAVAI usage will be sent to the related LangSmith account. Was run per
// SQS batch; in a long-lived container it only needs to happen once.
let langSmithReady: Promise<void> | undefined;
const setLangSmithKey = () => {
  langSmithReady ??= (async () => {
    try {
      process.env.LANGSMITH_API_KEY = await getLangSmithKey();
    } catch (error) {
      console.warn("Failed to set LangSmith API key:", error);
    }
  })();
  return langSmithReady;
};

// Runs one turn to completion, writing progress and the result to the job store.
// Was the body of the SQS handler's per-record loop; the queue is gone, so the
// submit handler calls this directly (see agentcore/job-store.ts enqueueJob).
export const processJob = async (messageId: string): Promise<void> => {
  await setLangSmithKey();

  {
    try {
      if (!messageId) return;

      const controller = new AbortController();
      registerRunning(messageId, () => controller.abort());

      // Get job from the in-process store (was: SELECT from the jobs table)
      const job = getJob(messageId);

      if (!job) {
        return;
      }

      if (job.cancelled) {
        return;
      }

      // Process the job
      const config = {
        configurable: { llmId: job.input.llmId, thread_id: job.input.threadId, effort: job.input.effort },
        signal: controller.signal
      };

      const app = await getLangApp();

      // Self-heal: if the thread already holds a tool_use that never received a
      // tool_result (e.g. a prior tool call threw before its result was submitted),
      // inject synthetic error tool_results FIRST so this call doesn't 400 on the
      // dangling tool_use. The reducer concatenates [prior..., these, new...], so
      // they land immediately after the orphaned AIMessage(tool_use) at the tail.
      // https://docs.langchain.com/oss/javascript/langchain/errors/INVALID_TOOL_RESULTS/
      let priorMessages: any[] = [];
      try {
        const priorState = await app.getState(config);
        priorMessages = priorState?.values?.messages ?? [];
      } catch (stateError) {
        console.warn(`Could not load thread state for ${messageId}; skipping tool-call repair:`, stateError);
      }

      const answeringToolCallId =
        job.kind === "tool" ? (job as ToolJob).input.message.tool_call_id : undefined;
      const messages: any[] = [...buildToolRepairMessages(priorMessages, answeringToolCallId)];
      let dataContexts: any = {};
      let graphs: any = [];

      if (job.kind === "tool") {

        const toolJob = job as ToolJob;

        let toolMessageContent: string;
        let humanMessage;

        if (Array.isArray(toolJob.input.message.content)) {
          toolMessageContent = "ok";
          humanMessage = new HumanMessage({ content: toolJob.input.message.content });
        } else {
          toolMessageContent = toolJob.input.message.content;
        }

        const toolMessage = new ToolMessage({
          content: toolMessageContent,
          tool_call_id: toolJob.input.message.tool_call_id,
        });

        messages.push(toolMessage);
        if (humanMessage) messages.push(humanMessage);
      } else {
        const messageJob = job as MessageJob;
        dataContexts = messageJob.input.dataContexts || {};
        graphs = messageJob.input.graphs || [];
        messages.push(new HumanMessage({ content: messageJob.input.message }));
      }

      // Stream the model. "messages" surfaces token chunks (user-facing text only);
      // "values" yields the final graph state, whose last message we hand to
      // buildResponse (preserving tool_calls/content-block structure).
      let accumulated = "";
      let lastWrittenLength = 0;
      let finalMessage: any;

      const writePartial = async () => {
        const text = messageTextToString(accumulated);
        // Guard on cancelled=false so a cancel landing between flushes is not resurrected.
        writeStreaming(messageId, { response: text });
        lastWrittenLength = accumulated.length;
      };

      try {
        const stream = await app.stream(
          { messages, dataContexts, graphs },
          { ...config, streamMode: ["messages", "values"] }
        );
        for await (const [mode, payload] of stream) {
          if (controller.signal.aborted) break;
          if (mode === "messages") {
            // payload is [AIMessageChunk, metadata]; accumulate only text content.
            const chunkText = messageTextToString((payload as any)[0]?.content);
            if (chunkText) {
              accumulated += chunkText;
              if (shouldFlush(accumulated, lastWrittenLength)) {
                await writePartial();
              }
            }
          } else if (mode === "values") {
            const msgs = (payload as any)?.messages;
            if (Array.isArray(msgs) && msgs.length) finalMessage = msgs[msgs.length - 1];
          }
        }
      } catch (streamError) {
        if (isAbortError(streamError, controller.signal)) {
          // User/cancel-initiated abort: leave the job cancelled, not errored.
          writeCancelled(messageId);
          return;
        }
        throw streamError;
      }

      // Flush any trailing text not yet written, so user-facing text that precedes a
      // tool call (a mixed text+tool turn, whose final write is requires_action and
      // carries no text) reaches the client complete.
      if (!controller.signal.aborted && accumulated.length > lastWrittenLength) {
        await writePartial();
      }

      if (controller.signal.aborted) {
        console.log(`Job ${messageId} aborted during streaming`);
        // The loop can exit via the cooperative `break` without the iterator
        // throwing, so mirror the catch-path cancelled write here. Guard on
        // status <> 'completed' (NOT cancelled=false): cancel.ts has already set
        // cancelled=true, so a cancelled=false guard would match zero rows.
        writeCancelled(messageId);
      } else {
        // Prefer the final graph state's message (preserves tool_calls); fall back to
        // the accumulated text if no "values" snapshot arrived.
        const built = finalMessage
          ? await buildResponse(finalMessage)
          : { response: messageTextToString(accumulated) };
        // A mixed text+tool turn ends with a requires_action payload that carries no
        // response text; attach the accumulated pre-tool text so the client can finalize
        // it regardless of streaming display or poll timing (the prior streaming updates
        // are overwritten by this terminal write).
        const output = withAccumulatedResponse(built, messageTextToString(accumulated));
        // Guard the terminal write too, so a late completion can't clobber a cancel.
        writeCompleted(messageId, output);
      }
    } catch (error) {
      console.error(`Error processing job:`, error);
      // Mark the job as failed so the client surfaces a real error immediately
      // instead of polling until it times out. These errors are typically
      // deterministic (e.g. an unsupported model parameter), so we do not retry.
      if (messageId) {
        const message = error instanceof Error ? error.message : String(error);
        writeError(messageId, message);
      }
    } finally {
      clearRunning(messageId);
    }
  }
};
