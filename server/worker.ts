import * as dotenv from "dotenv";
dotenv.config();

import { SQSClient, ReceiveMessageCommand, DeleteMessageCommand } from "@aws-sdk/client-sqs";
import { DynamoDBClient, UpdateItemCommand, GetItemCommand } from "@aws-sdk/client-dynamodb";
import { START, END, MemorySaver, MessagesAnnotation, StateGraph } from "@langchain/langgraph";
import { HumanMessage, trimMessages } from "@langchain/core/messages";
import { ChatPromptTemplate } from "@langchain/core/prompts";

import { instructions } from "./text/instructions.js";
import { codapApiDoc } from "./text/codap-api-documentation.js";
import { escapeCurlyBraces } from "./utils/rag-utils.js";
import { processCodapData } from "./utils/data-context-utils.js";
import { createModelInstance } from "./utils/llm-utils.js";
import { MAX_TOKENS, MAX_TOKENS_PER_CHUNK } from "./constants.js";
import { tools, toolCallResponse } from "./tools.js";
import { extractToolCalls, tokenCounter } from "./utils/utils.js";

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


// We use these values to track the token count of the CODAP data and limit the total token count of data sent to the model
// via LangChain's trimMessages utility.
let codapDataTokenCount = 0;
const userMessageTokenCount = 1000;

const llmInstances: Record<string, any> = {};

const getOrCreateModelInstance = (llmId: string) => {
  if (!llmInstances[llmId]) {
    llmInstances[llmId] = createModelInstance(llmId).bindTools(tools, { parallel_tool_calls: false });
  }
  return llmInstances[llmId];
};

let promptTemplate: ChatPromptTemplate;

const initializeLangApp = () => {
  promptTemplate = ChatPromptTemplate.fromMessages([
    ["system", `${instructions}, CODAP API documentation: ${escapeCurlyBraces(codapApiDoc)}`],
    ["placeholder", "{messages}"]
  ]);

  const callModel = async (state: any, modelConfig: any) => {
    const { llmId } = modelConfig.configurable;
    const llm = getOrCreateModelInstance(llmId);

    // Use the trimmer to ensure we don't send too much to the model.
    // The trimmer is used to limit the number of tokens in the conversation history.
    const trimmer = trimMessages({
      maxTokens: codapDataTokenCount + userMessageTokenCount,
      strategy: "last",
      tokenCounter,
      includeSystem: true,
      allowPartial: true
    });

    const trimmedMessages = await trimmer.invoke(state.messages);
    const prompt = await promptTemplate.invoke({ context: "", messages: trimmedMessages });
    const response = await llm.invoke(prompt);
    return { messages: response };
  };

  const workflow = new StateGraph(MessagesAnnotation)
    .addNode("model", callModel)
    .addEdge(START, "model")
    .addEdge("model", END);

  const memory = new MemorySaver();
  return workflow.compile({ checkpointer: memory });
};

const langApp = initializeLangApp();

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
  const { llmId, threadId, message: _message, codapData, isToolCall } = input;
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
    // Handle regular message
    if (codapData && typeof codapData === "object") {
      const processedCodapData = processCodapData(codapData);
      codapDataTokenCount = Math.min(
        codapDataTokenCount + processedCodapData.length * MAX_TOKENS_PER_CHUNK,
        MAX_TOKENS
      );
      messages.push(...processedCodapData);
    } else {
      messages.push(new HumanMessage({ content: _message }));
    }
  }

  const result = await langApp.invoke({ messages }, config);
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
