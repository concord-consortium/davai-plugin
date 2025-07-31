import * as dotenv from "dotenv";
dotenv.config();

import { SQSClient, ReceiveMessageCommand, DeleteMessageCommand } from "@aws-sdk/client-sqs";
import { DynamoDBClient, UpdateItemCommand, GetItemCommand } from "@aws-sdk/client-dynamodb";
import { HumanMessage } from "@langchain/core/messages";
import { langApp } from "./utils/llm-utils.js";
import { extractToolCalls, toolCallResponse } from "./utils/tool-utils.js";

// AWS clients
const sqs = new SQSClient({
  region: process.env.AWS_REGION,
  endpoint: process.env.SQS_ENDPOINT
});

const dynamodb = new DynamoDBClient({
  region: process.env.AWS_REGION,
  endpoint: process.env.DYNAMODB_ENDPOINT
});

const queueUrl = process.env.LLM_JOB_QUEUE_URL;
const tableName = process.env.DYNAMODB_TABLE;

const buildResponse = async (message: any) => {
  const toolCalls = extractToolCalls(message);
  // If there are tool calls, we need to handle them first.
  if (toolCalls?.[0]) {
    return await toolCallResponse(toolCalls[0]);
  } else {
    return { response: message.content };
  }
};

async function pollQueue() {
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

      const jobResult = await dynamodb.send(
        new GetItemCommand({
          TableName: tableName,
          Key: { messageId: { S: messageId } }
        })
      );

      const job = jobResult.Item;
      if (!job) {
        console.warn("Job not found in DynamoDB.");
        return;
      }

      if (job.cancelled?.BOOL) {
        console.log("Job was cancelled. Skipping.");
      } else {
        await processJob(job, messageId);
      }

      await sqs.send(
        new DeleteMessageCommand({
          QueueUrl: queueUrl,
          ReceiptHandle: message.ReceiptHandle
        })
      );
    }
  } catch (err) {
    console.error("Worker error:", err);
  }
}

// Process individual job
async function processJob(job: any, messageId: string) {
  const input = JSON.parse(job.input.S || "{}");
  const { llmId, threadId, message: _message, dataContexts, graphs, isToolCall } = input;
  const config = { configurable: { llmId, thread_id: threadId } };
  const messages: any[] = [];

  if (isToolCall) {
    // Handle tool call response
    let toolMessageContent: string;
    let humanMessage;

    // `message.content` will be an array if previously the user asked to describe a graph
    // ToolMessage doesn't support sending images back to the model
    // So we stub the response to the tool call, and follow up with HumanMessage
    if (Array.isArray(_message.content)) {
      // stub tool response
      toolMessageContent = "ok";
      humanMessage = new HumanMessage({ content: _message.content });
    } else {
      toolMessageContent = _message.content;
    }

    const { ToolMessage } = await import("@langchain/core/messages");
    const toolMessage = new ToolMessage({
      content: toolMessageContent,
      tool_call_id: _message.tool_call_id,
    });

    messages.push(toolMessage);

    if (humanMessage) {
      messages.push(humanMessage);
    }
  } else {
    messages.push(new HumanMessage({ content: _message }));
  }

  // Pass the user message and fresh CODAP data to langApp.
  // The CODAP data will be added to the prompt template.
  const result = await langApp.invoke({ 
    messages,
    dataContexts: dataContexts || {},
    graphs: graphs || []
  }, config);

  const lastMessage = result.messages[result.messages.length - 1];
  const output = await buildResponse(lastMessage);

  await dynamodb.send(
    new UpdateItemCommand({
      TableName: tableName,
      Key: { messageId: { S: messageId } },
      UpdateExpression: "SET #s = :s, #o = :o, updatedAt = :u",
      ExpressionAttributeNames: { "#s": "status", "#o": "output" },
      ExpressionAttributeValues: {
        ":s": { S: "completed" },
        ":o": { S: JSON.stringify(output) },
        ":u": { N: `${Date.now()}` }
      }
    })
  );

  console.log(`Job ${messageId} completed.`);
}

setInterval(pollQueue, 2000);
