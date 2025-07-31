import * as dotenv from "dotenv";
dotenv.config();

import express, { json } from "express";
import { HumanMessage, ToolMessage } from "@langchain/core/messages";
import { buildResponse, langApp } from "./utils/llm-utils.js";
import { DynamoDBClient, PutItemCommand, UpdateItemCommand, GetItemCommand } from "@aws-sdk/client-dynamodb";
import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import { nanoid } from "nanoid";

const dynamodb = new DynamoDBClient({
  region: process.env.AWS_REGION,
  endpoint: process.env.DYNAMODB_ENDPOINT
});

const sqs = new SQSClient({
  region: process.env.AWS_REGION,
  endpoint: process.env.SQS_ENDPOINT
});

const queueUrl = process.env.LLM_JOB_QUEUE_URL;
const tableName = process.env.DYNAMODB_TABLE;

const app = express();
const port = 3000;
app.use(json({ limit: "5mb" }));

// Middleware to check for the API secret in the request headers
app.use((req: any, res: any, next: any) => {
  if (req.method === "OPTIONS") {
    return next();
  }
  const token = req.headers.authorization;
  if (token !== process.env.DAVAI_API_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
});

// Track active message processing
// const activeMessages = new Map<string, AbortController>();

app.post("/default/davaiServer/tool", async (req, res) => {
  const { llmId, message, threadId } = req.body;
  const messageId = nanoid();

  try {
    const jobInput = {
      llmId,
      threadId,
      message,
      isToolCall: true
    };

    // Store job in DynamoDB
    await dynamodb.send(new PutItemCommand({
      TableName: tableName,
      Item: {
        messageId: { S: messageId },
        status: { S: "queued" },
        input: { S: JSON.stringify(jobInput) },
        createdAt: { N: `${Date.now()}` },
        updatedAt: { N: `${Date.now()}` },
        cancelled: { BOOL: false }
      }
    }));

    // Queue the message
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

// This is the main endpoint for use by the client app. We may want to add more, e.g. another for tool calls, etc.
// app.post("/default/davaiServer/message", async (req, res) => {
//   const { llmId, message, threadId, codapData, messageId } = req.body;
//   const config = { configurable: { thread_id: threadId, llmId } };

//   try {
//     const messages = [];

//     // If we have data contexts, process them before adding.
//     if (codapData && typeof codapData === "object") {
//       const processedCodapData = processCodapData(codapData);
//       codapDataTokenCount = Math.min(
//         codapDataTokenCount + processedCodapData.length * MAX_TOKENS_PER_CHUNK,
//         MAX_TOKENS
//       );

//       messages.push(...processedCodapData);
//     } else {
//       // Add the user's message
//       messages.push({
//         role: "user",
//         content: message,
//       });
//     }

//     // Create an AbortController for this request. This lets us cancel the request if needed.
//     const controller = new AbortController();
//     activeMessages.set(messageId, controller);

//     const output = await langApp.invoke(
//       { messages },
//       {
//         ...config,
//       signal: controller.signal
//       }
//     );

//     // Clean up the controller
//     activeMessages.delete(messageId);

//     const lastMessage = output.messages[output.messages.length - 1];
//     const response = await buildResponse(lastMessage);
//     res.json(response);
//   } catch (err: any) {
//     if (err.message === "Aborted") {
//       res.status(500).json({ error: "Message processing cancelled" });
//     } else {
//       console.error("Error in /api/message:", err);
//       console.error("Error stack:", err.stack);
//       res.status(500).json({ error: "LangChain Error", details: err.message });
//     }
//     activeMessages.delete(messageId);
//   }
// });

app.post("/default/davaiServer/message", async (req, res) => {
  const { llmId, message, threadId, codapData } = req.body;
  const messageId = nanoid();
  const config = { threadId, llmId };

  try {
    const jobInput = {
      llmId,
      threadId,
      message,
      codapData
    };

    // Store job in DynamoDB
    await dynamodb.send(new PutItemCommand({
      TableName: tableName,
      Item: {
        messageId: { S: messageId },
        status: { S: "queued" },
        input: { S: JSON.stringify(jobInput) },
        createdAt: { N: `${Date.now()}` },
        updatedAt: { N: `${Date.now()}` },
        cancelled: { BOOL: false }
      }
    }));

    // Queue the message
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

app.get("/default/davaiServer/status", async (req, res) => {
  const { messageId } = req.query;

  if (!messageId) {
    return res.status(400).json({ error: "Missing messageId" });
  }

  try {
    const result = await dynamodb.send(new GetItemCommand({
      TableName: tableName,
      Key: { messageId: { S: messageId as string } }
    }));

    if (!result.Item) {
      return res.status(404).json({ error: "Job not found" });
    }

    res.json({
      messageId,
      status: result.Item.status.S,
      output: result.Item.output?.S ? JSON.parse(result.Item.output.S) : null
    });
  } catch (err: any) {
    console.error("Error fetching job status:", err);
    res.status(500).json({ error: "Failed to fetch job status", details: err.message });
  }
});

// Endpoint for cancelling message processing
// app.post("/default/davaiServer/cancel", async (req, res) => {
//   const { messageId } = req.body;
//   const controller = activeMessages.get(messageId);
//   if (controller) {
//     controller.abort();
//     activeMessages.delete(messageId);
//     res.json({ status: "cancelled", message: "Message processing cancelled successfully" });
//   } else {
//     res.status(404).json({ error: "Message not found or already completed" });
//   }
// });

app.post("/default/davaiServer/cancel", async (req, res) => {
  const { messageId } = req.body;

  if (!messageId) {
    return res.status(400).json({ error: "Missing messageId" });
  }

  try {
    await dynamodb.send(new UpdateItemCommand({
      TableName: tableName,
      Key: { messageId: { S: messageId } },
      UpdateExpression: "SET #s = :s, cancelled = :c, updatedAt = :u",
      ExpressionAttributeNames: {
        "#s": "status"
      },
      ExpressionAttributeValues: {
        ":s": { S: "cancelled" },
        ":c": { BOOL: true },
        ":u": { N: `${Date.now()}` }
      }
    }));

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
