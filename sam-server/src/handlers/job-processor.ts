import { SQSEvent } from "aws-lambda";
import { Pool } from "pg";
import { HumanMessage, ToolMessage } from "@langchain/core/messages";
import { getLangApp } from "../utils/llm-utils";
import { buildToolRepairMessages, extractToolCalls, toolCallResponse } from "../utils/tool-utils";
import { messageTextToString, shouldFlush, isAbortError } from "../utils/stream-utils";
import { Job, ToolJob, MessageJob } from "../types";
import { getLangSmithKey } from "../utils/env-utils";

const pool = new Pool({
  connectionString: process.env.POSTGRES_CONNECTION_STRING
});

const buildResponse = async (message: any) => {
  const toolCalls = extractToolCalls(message);
  if (toolCalls?.[0]) {
    return await toolCallResponse(toolCalls[0]);
  }
  return { response: message.content };
};

// Track currently running jobs
const runningJobs = new Map<
  string,
  { abort: () => void }
>();

async function listenForCancellations() {
  const client = await pool.connect();
  await client.query("LISTEN job_cancelled");
  client.on("notification", (msg) => {
    if (msg.channel === "job_cancelled" && msg.payload) {
      try {
        const payload = JSON.parse(msg.payload);
        const cancelledId = payload.messageId;
        console.log(`[CANCEL] Received cancel signal for job ${cancelledId}`);

        const runningJob = runningJobs.get(cancelledId);
        if (runningJob) {
          console.log(`[CANCEL] Aborting running job ${cancelledId}`);
          runningJob.abort();
          runningJobs.delete(cancelledId);
        }
      } catch (err) {
        console.error("Failed to parse cancellation payload", err);
      }
    }
  });
}

// listen for job cancellations
listenForCancellations();

export const handler = async (event: SQSEvent): Promise<void> => {
  // Set LangSmith API key for LangChain integration if available. When set,
  // data about DAVAI usage will be sent to the related LangSmith account.
  try {
    const langSmithKey = await getLangSmithKey();
    process.env.LANGSMITH_API_KEY = langSmithKey;
  } catch (error) {
    console.warn("Failed to set LangSmith API key:", error);
  }

  for (const record of event.Records) {
    let messageId: string | undefined;
    try {
      const body = JSON.parse(record.body);
      messageId = body.messageId;
      if (!messageId) continue;

      const controller = new AbortController();
      runningJobs.set(messageId, { abort: () => controller.abort() });

      // Get job from database
      const { rows } = await pool.query(`SELECT * FROM jobs WHERE message_id = $1`, [messageId]);

      if (rows.length === 0) {
        continue;
      }

      const job: Job = rows[0];

      if (job.cancelled) {
        continue;
      }

      // Process the job
      const config = {
        configurable: { llmId: job.input.llmId, thread_id: job.input.threadId },
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
        await pool.query(
          `UPDATE jobs SET status='streaming', output=$1, updated_at=NOW()
           WHERE message_id=$2 AND cancelled=false`,
          [{ response: text }, messageId]
        );
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
          await pool.query(
            `UPDATE jobs SET status='cancelled', updated_at=NOW()
             WHERE message_id=$1 AND status <> 'completed'`,
            [messageId]
          );
          continue;
        }
        throw streamError;
      }

      if (controller.signal.aborted) {
        console.log(`Job ${messageId} aborted during streaming`);
      } else {
        // Prefer the final graph state's message (preserves tool_calls); fall back to
        // the accumulated text if no "values" snapshot arrived.
        const output = finalMessage
          ? await buildResponse(finalMessage)
          : { response: messageTextToString(accumulated) };
        // Guard the terminal write too, so a late completion can't clobber a cancel.
        await pool.query(
          `UPDATE jobs SET status='completed', output=$1, updated_at=NOW()
           WHERE message_id=$2 AND cancelled=false`,
          [output, messageId]
        );
      }
    } catch (error) {
      console.error(`Error processing job:`, error);
      // Mark the job as failed so the client surfaces a real error immediately
      // instead of polling until it times out. These errors are typically
      // deterministic (e.g. an unsupported model parameter), so we do not retry
      // via SQS (no batchItemFailures entry).
      if (messageId) {
        const message = error instanceof Error ? error.message : String(error);
        try {
          await pool.query(
            `UPDATE jobs
            SET status = $1, output = $2, updated_at = NOW()
            WHERE message_id = $3`,
            ["error", { error: message }, messageId]
          );
        } catch (dbError) {
          console.error(`Failed to mark job ${messageId} as errored:`, dbError);
        }
      }
    }
  }
};
