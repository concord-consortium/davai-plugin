import * as dotenv from "dotenv";
dotenv.config();

import express, { json } from "express";
import { Pool } from "pg";
import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import { nanoid } from "nanoid";

import { MessageJobInput, ToolJobInput } from "./types";

const pool = new Pool({
  connectionString: process.env.POSTGRES_CONNECTION_STRING
});

const sqs = new SQSClient({
  region: process.env.AWS_REGION,
  endpoint: process.env.SQS_ENDPOINT
});

const queueUrl = process.env.LLM_JOB_QUEUE_URL;

const app = express();
const port = 5000;
app.use(json({ limit: "5mb" }));

// cors middleware
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*"); // Allow all origins
  res.header("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS"); // Allowed HTTP methods
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization"); // Allowed headers

  // Respond to preflight requests
  if (req.method === "OPTIONS") {
    return res.sendStatus(204); // No Content
  }

  next();
});

// Middleware for API secret check
app.use((req: any, res: any, next: any) => {
  if (req.method === "OPTIONS") return next();
  if (req.headers.authorization !== process.env.DAVAI_API_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
});

async function insertJob(messageId: string,
  kind: "message" | "tool",
  jobInput: MessageJobInput | ToolJobInput
) {
  await pool.query(
    `INSERT INTO jobs (message_id, kind, status, input, created_at, updated_at, cancelled)
     VALUES ($1, $2, $3, $4, NOW(), NOW(), $5)`,
    [messageId, kind, "queued", jobInput, false]
  );
}

app.post("/default/davaiServer/message", async (req, res) => {
  const { llmId, message, threadId, dataContexts, graphs } = req.body;
  const messageId = nanoid();

  try {
    const jobInput: MessageJobInput = { llmId, threadId, message, dataContexts, graphs };

    await insertJob(messageId, "message", jobInput);

    await sqs.send(new SendMessageCommand({
      QueueUrl: queueUrl,
      MessageBody: JSON.stringify({ messageId })
    }));

    res.status(202).json({ messageId, status: "queued" });
  } catch (err: any) {
    console.error("Error enqueuing message:", err);
    res.status(500).json({ error: "Failed to queue message", details: err.message });
  }
});

app.post("/default/davaiServer/tool", async (req, res) => {
  const { llmId, message, threadId } = req.body;
  const messageId = nanoid();

  try {
    const jobInput: ToolJobInput = { llmId, threadId, message };

    await insertJob(messageId, "tool", jobInput);

    await sqs.send(new SendMessageCommand({
      QueueUrl: queueUrl,
      MessageBody: JSON.stringify({ messageId })
    }));

    res.status(202).json({ messageId, status: "queued" });
  } catch (err: any) {
    console.error("Error enqueuing tool response:", err);
    res.status(500).json({ error: "Failed to queue tool response", details: err.message });
  }
});

app.get("/default/davaiServer/status", async (req, res) => {
  const { messageId } = req.query;
  if (!messageId) return res.status(400).json({ error: "Missing messageId" });

  try {
    const { rows } = await pool.query(
      `SELECT status, output FROM jobs WHERE message_id = $1`,
      [messageId]
    );

    if (rows.length === 0) return res.status(404).json({ error: "Job not found" });

    const job = rows[0];
    res.json({
      messageId,
      status: job.status,
      output: job.output || null
    });
  } catch (err: any) {
    console.error("Error fetching job status:", err);
    res.status(500).json({ error: "Failed to fetch job status", details: err.message });
  }
});

app.post("/default/davaiServer/cancel", async (req, res) => {
  const { messageId } = req.body;
  if (!messageId) return res.status(400).json({ error: "Missing messageId" });

  try {
    await pool.query(
      `UPDATE jobs
       SET status = $1, cancelled = $2, updated_at = NOW()
       WHERE message_id = $3`,
      ["cancelled", true, messageId]
    );

    res.json({ status: "cancelled", message: "Job marked as cancelled" });
  } catch (err: any) {
    console.error("Error cancelling job:", err);
    res.status(500).json({ error: "Failed to cancel job", details: err.message });
  }
});

app.listen(port, () => {
  console.log(`LangChain server listening on http://localhost:${port}`);
});

export default app;
