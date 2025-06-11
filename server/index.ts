import express, { json } from "express";
import * as dotenv from "dotenv";
import { START, END, MemorySaver, MessagesAnnotation, StateGraph } from "@langchain/langgraph";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { MemoryVectorStore } from "langchain/vectorstores/memory";
import { Document } from "@langchain/core/documents";
import { instructions } from "./instructions.js";
import { codapApiDoc } from "./codap-api-documentation.js";
import { escapeCurlyBraces, processMarkdownDoc, setupVectorStore } from "./utils/rag-utils.js";
import { processDataContexts } from "./utils/data-context-utils.js";
import { createModelInstance } from "./utils/llm-utils.js";

dotenv.config();

const app = express();
const port = 5000;
app.use(json());

// Initialize the vector store cache to avoid re-creating it for each request.
let vectorStoreCache: { [key: string]: MemoryVectorStore } = {};

let processedCodapApiDoc: Document<Record<string, any>>[] = [];
let promptTemplate: ChatPromptTemplate;

export const initializeApp = async () => {
  console.log("Initializing application...");

  // Process the CODAP Plugin API documentation content
  processedCodapApiDoc = await processMarkdownDoc(codapApiDoc);

  promptTemplate = ChatPromptTemplate.fromMessages([
    ["system", `${instructions}\n\nHere is the relevant CODAP API documentation:\n{context}`],
    ["placeholder", "{messages}"],
  ]);

  console.log("Application initialized successfully.");
};

let activeLLMInstance: Record<string, any> | undefined = undefined;

const getOrCreateModelInstance = (llmId: string): Record<string, any> => {
  if (!activeLLMInstance) {
    activeLLMInstance = createModelInstance(llmId);
  }
  return activeLLMInstance;
};

const callModel = async (state: any, modelConfig: any) => {
  const { llmId } = modelConfig.configurable;
  const llm = getOrCreateModelInstance(llmId);
  const llmRealId = JSON.parse(llmId).id;

  // Get the last user message to use as the query
  const lastUserMessage = state.messages
    .filter((msg: any) => msg.role === "user")
    .pop()?.content || state.messages[0]?.content;

  // Retrieve relevant documents using the appropriate embeddings
  const vectorStore = vectorStoreCache[llmRealId] ?? await setupVectorStore(processedCodapApiDoc, llmRealId, vectorStoreCache);
  const relevantDocs = await vectorStore.similaritySearch(lastUserMessage, 3);

  // Clean the context to ensure it doesn't contain any template variables
  const context = relevantDocs
    .map((doc: Document) => escapeCurlyBraces(doc.pageContent))
    .join("\n\n");

  const prompt = await promptTemplate.invoke({
    context,
    messages: state.messages,
  });

  const response = await llm.invoke(prompt);

  if (response?.tool_calls?.[0]) {
    const functionCall = response.tool_calls[0];
    return {
      messages: response,
      function_call: {
        name: functionCall.id,
        arguments: functionCall.args,
      },
    };
  }

  return { messages: response };
};

const workflow = new StateGraph(MessagesAnnotation)
  .addNode("model", callModel)
  .addEdge(START, "model")
  .addEdge("model", END);

const memory = new MemorySaver();
const langApp = workflow.compile({ checkpointer: memory });

// This is the main endpoint for use by the client app. We may want to add more, e.g. another for tool calls, etc.
app.post("/api/message", async (req, res) => {
  const { llmId, message, threadId, dataContexts } = req.body;
  const config = { configurable: { thread_id: threadId, llmId } };

  try {
    const messages = [];

    // If we have data contexts, process them first
    if (dataContexts && typeof dataContexts === "object") {
      // console.log("Processing data contexts");
      messages.push(...processDataContexts(dataContexts));
    }

    // Add the user's message
    messages.push({
      role: "user",
      content: message,
    });

    // console.log("Final messages array:", messages.map(m => ({ role: m.role, contentLength: m.content.length })));

    const output = await langApp.invoke({ messages }, config);
    const lastMessage = output.messages[output.messages.length - 1];

    res.json({ response: lastMessage.content });
  } catch (err: any) {
    console.error("Error in /api/message:", err);
    console.error("Error stack:", err.stack);
    res.status(500).json({ error: "LangChain Error", details: err.message });
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
