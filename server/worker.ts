import * as dotenv from "dotenv";
dotenv.config();

import { SQSClient, ReceiveMessageCommand, DeleteMessageCommand } from "@aws-sdk/client-sqs";
import { Pool } from "pg";
import { HumanMessage } from "@langchain/core/messages";
import { getLangApp } from "./utils/llm-utils.js";
import { extractToolCalls, toolCallResponse } from "./utils/tool-utils.js";
import { Job } from "./types";

const polling = process.env.DEV_MODE === "true";

const pool = new Pool({
  connectionString: process.env.POSTGRES_CONNECTION_STRING
});

const sqs = new SQSClient({
  region: process.env.AWS_REGION,
  endpoint: process.env.SQS_ENDPOINT
});

const queueUrl = process.env.LLM_JOB_QUEUE_URL;

// Track currently running jobs
const runningJobs = new Map<
  string,
  { abort: () => void }
>();

const buildResponse = async (message: any) => {
  const toolCalls = extractToolCalls(message);
  if (toolCalls?.[0]) {
    return await toolCallResponse(toolCalls[0]);
  }
  return { response: message.content };
};

// Graceful shutdown
async function shutdown() {
  console.log("Shutting down worker...");
  await pool.end();
  process.exit(0);
}

// Pull next job from SQS
async function pullNextJobFromQueue() {
  try {
    const receiveParams = {
      QueueUrl: queueUrl,
      MaxNumberOfMessages: 1,
      WaitTimeSeconds: 1
    };

    const response = await sqs.send(new ReceiveMessageCommand(receiveParams));

    if (response.Messages?.length) {
      const message = response.Messages[0];
      const body = JSON.parse(message.Body || "{}");
      const { messageId } = body;

      console.log(`[${new Date().toISOString()}] Processing messageId: ${messageId}`);

      const { rows } = await pool.query(`SELECT * FROM jobs WHERE message_id = $1`, [messageId]);

      if (rows.length === 0) {
        console.warn("Job not found in Postgres.");
      } else {
        const job: Job = rows[0];
        console.log("job", job);

        if (job.cancelled) {
          console.log("Job was cancelled. Skipping.");
        } else {
          await processJob(job, messageId);
        }
      }

      await sqs.send(
        new DeleteMessageCommand({
          QueueUrl: queueUrl,
          ReceiptHandle: message.ReceiptHandle
        })
      );
    } else {
      console.log("No messages found.");
    }
  } catch (err) {
    console.error("Worker error:", err);
  }

  if (!polling) {
    await shutdown();
  }
}

async function processJob(job: Job, messageId: string) {
  const controller = new AbortController();
  runningJobs.set(messageId, { abort: () => controller.abort() });

  const config = { configurable: { llmId: job.input.llmId, thread_id: job.input.threadId } };
  const messages: any[] = [];
  let dataContexts:any = {};
  let graphs:any = [];

  if (job.kind === "tool") {
    const { ToolMessage } = await import("@langchain/core/messages");

    let toolMessageContent: string;
    let humanMessage;

    if (Array.isArray(job.input.message.content)) {
      toolMessageContent = "ok";
      humanMessage = new HumanMessage({ content: job.input.message.content });
    } else {
      toolMessageContent = job.input.message.content;
    }

    const toolMessage = new ToolMessage({
      content: toolMessageContent,
      tool_call_id: job.input.message.tool_call_id,
    });

    messages.push(toolMessage);
    if (humanMessage) messages.push(humanMessage);
  } else {
    dataContexts = job.input.dataContexts || {};
    graphs = job.input.graphs || [];
    messages.push(new HumanMessage({ content: job.input.message }));
  }

  try {
    const result = await (await getLangApp()).invoke(
      { messages, dataContexts, graphs },
      { ...config, signal: controller.signal }
    );

    if (controller.signal.aborted) {
      console.log(`Job ${messageId} aborted before completion`);
      return;
    }

    const lastMessage = result.messages[result.messages.length - 1];
    const output = await buildResponse(lastMessage);

    await pool.query(
      `UPDATE jobs
       SET status = $1, output = $2, updated_at = NOW()
       WHERE message_id = $3`,
      ["completed", output, messageId]
    );

    console.log(`Job ${messageId} (${job.kind}) completed.`);
  } finally {
    runningJobs.delete(messageId);
  }
}

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

// Start
pullNextJobFromQueue();

if (polling) {
  console.log("DEV_MODE: worker polling every 2 seconds");
  setInterval(pullNextJobFromQueue, 2000);
}
