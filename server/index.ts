import express, { json } from "express";
import * as dotenv from "dotenv";
import { START, END, MemorySaver, MessagesAnnotation, StateGraph } from "@langchain/langgraph";
import { BaseMessage, HumanMessage, ToolMessage, trimMessages } from "@langchain/core/messages";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { instructions } from "./text/instructions.js";
import { codapApiDoc } from "./text/codap-api-documentation.js";
import { escapeCurlyBraces } from "./utils/rag-utils.js";
import { processCodapData } from "./utils/data-context-utils.js";
import { createModelInstance } from "./utils/llm-utils.js";
import { MAX_TOKENS, MAX_TOKENS_PER_CHUNK } from "./constants.js";
import { toolCallResponse, tools } from "./tools.js";
import { extractToolCalls, tokenCounter } from "./utils/utils.js";

dotenv.config();

const app = express();
const port = 3000;
app.use(json());

// We use these values to track the token count of the CODAP data and limit the total token count of data sent to the model
// via LangChain's trimMessages utility.
let codapDataTokenCount = 0;
const userMessageTokenCount = 1000;

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

let promptTemplate: ChatPromptTemplate;

const buildResponse = async (message: BaseMessage) => {
  const toolCalls = extractToolCalls(message);

  // If there are tool calls, we need to handle them first.
  if (toolCalls?.[0]) {
    const response = await toolCallResponse(toolCalls?.[0]);
    return response;
  } else {
    return { response: message.content };
  }
};

export const initializeApp = async () => {
  console.log("Initializing application...");

  promptTemplate = ChatPromptTemplate.fromMessages([
    ["system", `${instructions}, CODAP API documentation: ${escapeCurlyBraces(codapApiDoc)}`],
    ["placeholder", "{messages}"],
]);

  console.log("Application initialized successfully.");
};

let llmInstances: Record<string, any> = {};

const getOrCreateModelInstance = (llmId: string): Record<string, any> => {
  if (!llmInstances[llmId]) {
    llmInstances[llmId] = createModelInstance(llmId).bindTools(tools, { parallel_tool_calls: false });
  }
  return llmInstances[llmId];
};

const callModel = async (state: any, modelConfig: any) => {
  const { llmId } = modelConfig.configurable;
  const llm = getOrCreateModelInstance(llmId);
  const llmRealId = JSON.parse(llmId).id;

  const lastUserMessage = state.messages
    .filter((msg: any) => msg instanceof HumanMessage)
    .pop()?.content;

  let context = "";
  // Use the trimmer to ensure we don't send too much to the model
  // The trimmer is used to limit the number of tokens in the conversation history.
  const trimmer = trimMessages({
    maxTokens: codapDataTokenCount + userMessageTokenCount,
    strategy: "last",
    tokenCounter,
    includeSystem: true,
    allowPartial: true,
  });
  const trimmedMessages = await trimmer.invoke(state.messages);

  const prompt = await promptTemplate.invoke({
    context,
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

app.post("/default/davaiServer/tool", async (req, res) => {
  const { llmId, message, threadId } = req.body;
  const config = { configurable: { thread_id: threadId, llmId } };

  try {
    const messages = [];
    const toolResponse = new ToolMessage({
      content: message.content,
      tool_call_id: message.tool_call_id,
    });

    messages.push(toolResponse);

    const toolResponseOutput = await langApp.invoke({ messages }, config);

    // There may be a follow-on tool call in the response, so we need to check for that and handle it.
    const lastMessage = toolResponseOutput.messages[toolResponseOutput.messages.length - 1];
    const response = await buildResponse(lastMessage);
    res.json(response);
  } catch (err: any) {
    console.error("Error in /api/message:", err);
    console.error("Error stack:", err.stack);
    res.status(500).json({ error: "LangChain Error", details: err.message });
  }
});

// This is the main endpoint for use by the client app. We may want to add more, e.g. another for tool calls, etc.
app.post("/default/davaiServer/message", async (req, res) => {
  const { llmId, message, threadId, codapData, messageId } = req.body;
  const config = { configurable: { thread_id: threadId, llmId } };

  try {
    const messages = [];

    // If we have data contexts, process them before adding.
    if (codapData && typeof codapData === "object") {
      const processedCodapData = processCodapData(codapData);
      codapDataTokenCount = Math.min(
        codapDataTokenCount + processedCodapData.length * MAX_TOKENS_PER_CHUNK,
        MAX_TOKENS
      );

      messages.push(...processedCodapData);
    } else {
      // Add the user's message
      messages.push({
        role: "user",
        content: message,
      });
    }

    // Create an AbortController for this request. This lets us cancel the request if needed.
    const controller = new AbortController();
    activeMessages.set(messageId, controller);

    const output = await langApp.invoke(
      { messages },
      {
        ...config,
        signal: controller.signal
      }
    );

    // Clean up the controller
    activeMessages.delete(messageId);

    const lastMessage = output.messages[output.messages.length - 1];
    const response = await buildResponse(lastMessage);
    res.json(response);
  } catch (err: any) {
    if (err.message === "Aborted") {
      res.status(500).json({ error: "Message processing cancelled" });
    } else {
      console.error("Error in /api/message:", err);
      console.error("Error stack:", err.stack);
      res.status(500).json({ error: "LangChain Error", details: err.message });
    }
    activeMessages.delete(messageId);
  }
});

// Endpoint for cancelling message processing
app.post("/default/davaiServer/cancel", async (req, res) => {
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
