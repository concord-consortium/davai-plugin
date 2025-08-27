import { SQSEvent, SQSBatchResponse, SQSBatchItemFailure } from "aws-lambda";
import { Pool } from "pg";
import { HumanMessage, ToolMessage } from "@langchain/core/messages";
import { getLangApp } from "../utils/llm-utils";
import { extractToolCalls, toolCallResponse } from "../utils/tool-utils";
import { Job, ToolJob, MessageJob } from "../types";
import { getLangSmithKey } from "../utils/env-utils";

const pool = new Pool({
  connectionString: process.env.POSTGRES_CONNECTION_STRING
});

const buildResponse = async (message: any) => {
  const toolCalls = extractToolCalls(message);
  if (toolCalls?.[0]) {
    return await toolCallResponse(toolCalls?.[0]);
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

export const handler = async (event: SQSEvent): Promise<SQSBatchResponse> => {
  // Set LangSmith API key for LangChain integration if available. When set,
  // data about DAVAI usage will be sent to the related LangSmith account.
  try {
    const langSmithKey = await getLangSmithKey();
    process.env.LANGSMITH_API_KEY = langSmithKey;
  } catch (error) {
    console.warn("Failed to set LangSmith API key:", error);
  }

  const batchItemFailures: SQSBatchItemFailure[] = [];

  for (const record of event.Records) {
    try {
      const body = JSON.parse(record.body);
      const { messageId } = body;

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
      const messages: any[] = [];
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

      // Process with LangGraph
      const result = await (await getLangApp()).invoke(
        { messages, dataContexts, graphs },
        config
      );

      if (controller.signal.aborted) {
        console.log(`Job ${messageId} aborted before completion`);
      } else {

        const lastMessage = result.messages[result.messages.length - 1];
        const output = await buildResponse(lastMessage);

        // Update job status
        await pool.query(
          `UPDATE jobs
          SET status = $1, output = $2, updated_at = NOW()
          WHERE message_id = $3`,
          ["completed", output, messageId]
        );
      }
    } catch (error) {
      console.error(`Error processing job:`, error);
      batchItemFailures.push({
        itemIdentifier: record.messageId
      });
    }
  }

  return {
    batchItemFailures
  };
};
