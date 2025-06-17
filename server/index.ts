import express, { json } from "express";
import * as dotenv from "dotenv";
import { START, END, MemorySaver, MessagesAnnotation, StateGraph } from "@langchain/langgraph";
import { BaseMessage, HumanMessage, SystemMessage, ToolMessage, trimMessages } from "@langchain/core/messages";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { instructions } from "./text/instructions.js";
import { codapApiDoc } from "./text/codap-api-documentation.js";
import { escapeCurlyBraces } from "./utils/rag-utils.js";
import { processDataContexts } from "./utils/data-context-utils.js";
import { createModelInstance } from "./utils/llm-utils.js";
import { CHARS_PER_TOKEN, MAX_TOKENS_PER_CHUNK } from "./constants.js";
import { toolCallResponse, tools } from "./tools.js";

dotenv.config();

const app = express();
const port = 3000;
app.use(json());

// Initialize the vector store cache to avoid re-creating it for each request.
// let vectorStoreCache: { [key: string]: MemoryVectorStore } = {};

const tokenCounter = (messages: BaseMessage[]) => {
let count = 0;

for (const msg of messages) {
    if (msg instanceof SystemMessage) continue;

    const c = msg.content;

    if (typeof c === "string") {
      count += c.length;
    } else if (Array.isArray(c)) {
      // count only the text blocks; ignore images
      for (const block of c) {
        if (block.type === "text") count += block.text.length;
      }
    } else if (c) {
      // object (e.g. tool/function payload) – rough estimate
      count += JSON.stringify(c).length;
    }                                     // else undefined → add 0
  }
  return count / CHARS_PER_TOKEN;
  };

// The trimmer is used to limit the number of tokens in the conversation history.
const trimmer = trimMessages({
  maxTokens: MAX_TOKENS_PER_CHUNK,
  strategy: "last",
  tokenCounter,
  includeSystem: true,
  allowPartial: true,
});

// let processedCodapApiDoc: Document[] = [];
let promptTemplate: ChatPromptTemplate;

export const initializeApp = async () => {
  console.log("Initializing application...");

  // promptTemplate = ChatPromptTemplate.fromMessages([
  //   ["system", `${instructions}`],
  //   ["placeholder", "{messages}"],
  // ]);

  // processedCodapApiDoc = chunkCodapDocumentation(codapApiDoc);

  promptTemplate = ChatPromptTemplate.fromMessages([
    ["system", `${instructions} Here is the relevant CODAP API documentation:\n ${escapeCurlyBraces(codapApiDoc)}`],
    ["placeholder", "{messages}"],
  ]);

  console.log("Application initialized successfully.");
};

let activeLLMInstance: Record<string, any> | undefined = undefined;

const getOrCreateModelInstance = (llmId: string): Record<string, any> => {
  if (!activeLLMInstance) {
    activeLLMInstance = createModelInstance(llmId).bindTools(tools);
  }
  return activeLLMInstance;
};

const callModel = async (state: any, modelConfig: any) => {
  const { llmId } = modelConfig.configurable;
    const llm = getOrCreateModelInstance(llmId);

  // Use the trimmer to ensure we don't send too much to the model
  const trimmedMessages = await trimmer.invoke(state.messages);

    const prompt = await promptTemplate.invoke({
      messages: trimmedMessages,
    });

  const response = await llm.invoke(prompt);

  return { messages: response };
};

const workflow = new StateGraph(MessagesAnnotation)
  .addNode("model", callModel)
  .addEdge(START, "model")
  .addEdge("model", END);

const memory = new MemorySaver();
const langApp = workflow.compile({ checkpointer: memory });

// Track active message processing
const activeMessages = new Map<string, AbortController>();

app.post("/api/tool", async (req, res) => {
  const { llmId, message, threadId } = req.body;
  const config = { configurable: { thread_id: threadId, llmId } };

  try {
    const messages = [];
    let toolMessageContent: string;
    let humanMessage;

    // `message.content` will be an array if previously the user asked to describe a graph
    // ToolMessage doesn't support sending images back to the model
    // So we stub the response to the tool call, and follow up with HumanMessage
    if (Array.isArray(message.content)) {
      // stub tool response
      toolMessageContent = "ok";
      humanMessage = new HumanMessage({ content: message.content });
    } else {
      toolMessageContent = message.content;
    }

    const toolMessage = new ToolMessage({
      content: toolMessageContent,
      tool_call_id: message.tool_call_id,
    });

    messages.push(toolMessage);

    if (humanMessage) {
      messages.push(humanMessage);
    }

    const toolResponseOutput = await langApp.invoke({ messages }, config);

    // There may be a follow-on tool call in the response, so we need to check for that and handle it.
    const toolCalls = (toolResponseOutput.messages[toolResponseOutput.messages.length - 1] as any).tool_calls;
    const toolCall = toolCalls?.[0];

    if (toolCall) {
        const response = await toolCallResponse(toolCall);
        res.json(response);
    } else {
      res.json({ response: toolResponseOutput.messages[toolResponseOutput.messages.length - 1].content });
    }
  } catch (err: any) {
    if (err.message === "Aborted") {
      res.status(499).json({ error: "Message processing cancelled" });
    } else {
      console.error("Error in /api/message:", err);
      console.error("Error stack:", err.stack);
      res.status(500).json({ error: "LangChain Error", details: err.message });
    }
  }
});

// This is the main endpoint for use by the client app. We may want to add more, e.g. another for tool calls, etc.
app.post("/api/message", async (req, res) => {
  const { llmId, message, threadId, dataContexts, messageId } = req.body;
  const config = { configurable: { thread_id: threadId, llmId } };

  try {
    const messages = [];

    // If we have data contexts, process them before adding.
    if (dataContexts && typeof dataContexts === "object") {
      messages.push(...processDataContexts(dataContexts));
    } else {
      // Add the user's message
      messages.push({
        role: "user",
        content: message,
      });
    }

    // Create an AbortController for this request. This lets us to cancel the request if needed.
    const controller = new AbortController();
    activeMessages.set(messageId, controller);

    const output = await langApp.invoke(
      { messages },
      {
        ...config,
      signal: controller.signal
      }
    );
    const lastMessage = output.messages[output.messages.length - 1];

    // Clean up the controller
    activeMessages.delete(messageId);

    const toolCall = (lastMessage && "tool_calls" in lastMessage && Array.isArray((lastMessage as any).tool_calls))
        ? (lastMessage as any).tool_calls[0]
        : undefined;

    if (toolCall) {
      const response = await toolCallResponse(toolCall);
      res.json(response);
    } else {
      res.json({ response: lastMessage.content });
    }
  } catch (err: any) {
    if (err.message === "Aborted") {
      res.status(499).json({ error: "Message processing cancelled" });
    } else {
      console.error("Error in /api/message:", err);
      console.error("Error stack:", err.stack);
      res.status(500).json({ error: "LangChain Error", details: err.message });
    }
    activeMessages.delete(messageId);
  }
});

// Endpoint for cancelling message processing
app.post("/api/cancel", async (req, res) => {
  const { messageId } = req.body;
  const controller = activeMessages.get(messageId);
  if (controller) {
    controller.abort();
    activeMessages.delete(messageId);
    res.json({ status: "cancelled", message: "Message processing cancelled successfully" });
  } else {
    res.status(404).json({ error: "Message not found or already completed" });
  }
});


initializeApp()
  .then(() => {
    app.listen(port, () => {
      console.log(`LangChain server listening on http://localhost:${port}`);
    });
  })
  .catch((err) => {
    console.error("Failed to initialize application:", err);
    process.exit(1);
  });

export default app;
