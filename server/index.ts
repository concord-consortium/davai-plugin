import express, { json } from "express";
import * as dotenv from "dotenv";
import { START, END, MemorySaver, MessagesAnnotation, StateGraph } from "@langchain/langgraph";
import { ChatOpenAI } from "@langchain/openai";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { MemoryVectorStore } from "langchain/vectorstores/memory";
import { Document } from "@langchain/core/documents";
import { instructions } from "./instructions.js";
import { codapApiDoc } from "./codap-api-documentation.js";
import { processMarkdownDoc, setupVectorStore } from "./utils/rag-utils.js";

dotenv.config();

const app = express();
const port = 5000;
app.use(json());

// Initialize the vector store cache to avoid re-creating it for each request.
let vectorStoreCache: { [key: string]: MemoryVectorStore } = {};

// Process the CODAP Plugin API documentation content and add it to the prompt template.
const processedCodapApiDoc = await processMarkdownDoc(codapApiDoc);

const createModelInstance = (llm: string) => {
  const llmObj = JSON.parse(llm);
  const { id, provider} = llmObj;
  if (provider === "OpenAI") {
    return new ChatOpenAI({
      model: id,
      temperature: 0,
      apiKey: process.env.OPENAI_API_KEY,
    });
  }
  if (provider === "Google") {
    return new ChatGoogleGenerativeAI({
      model: id,
      temperature: 0,
      apiKey: process.env.GOOGLE_API_KEY,
    });
  }
  throw new Error(`Unsupported LLM provider: ${provider}`);

};

const promptTemplate = ChatPromptTemplate.fromMessages([
  ["system", `${instructions}\n\nHere is the relevant CODAP API documentation:\n{context}`],
  ["placeholder", "{messages}"],
]);

const callModel = async (state: any, modelConfig: any) => {
  const { llmId } = modelConfig.configurable;
  const llm = createModelInstance(llmId);
  const llmRealId = JSON.parse(llmId).id;

  // Get the last user message to use as the query
  const lastUserMessage = state.messages
    .filter((msg: any) => msg.role === "user")
    .pop()?.content || state.messages[0]?.content;  // Fallback to first message if no user message

  // Retrieve relevant documents using the appropriate embeddings
  const vectorStore = await setupVectorStore(processedCodapApiDoc, llmRealId, vectorStoreCache);
  const relevantDocs = await vectorStore.similaritySearch(lastUserMessage, 3);
  
  // Clean the context to ensure it doesn't contain any template variables
  const context = relevantDocs
    .map((doc: Document) => {
      // Escape JSON examples in the content by doubling the curly braces
      return doc.pageContent.replace(/```json\n([\s\S]*?)\n```/g, (match) => {
        return match
          .replace(/{/g, "{{")
          .replace(/}/g, "}}");
      });
    })
    .join("\n\n");

  // Create the prompt with the retrieved context
  const prompt = await promptTemplate.invoke({
    context,
    messages: state.messages
  });

  const response = await llm.invoke(prompt);

  // If the response is a function call, parse it
  if (response?.tool_calls?.[0]) {
    const functionCall = response.tool_calls[0];
    return { 
      messages: response,
      function_call: {
        name: functionCall.id,
        arguments: functionCall.args
      }
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
  const { llmId, message, threadId, isSystemMessage } = req.body;
  const config = { configurable: { thread_id: threadId, llmId } };

  try {
    const input = isSystemMessage ? [{ role: "system", content: message }] : [{ role: "user", content: message }];
    const output = await langApp.invoke({ messages: input }, config);
    const lastMessage = output.messages[output.messages.length - 1];

    res.json({ response: lastMessage.content });
  } catch (err: any) {
    console.error("Error in /api/message:", err);
    console.error("Error stack:", err.stack);
    res.status(500).json({ error: "LangChain Error", details: err.message });
  }
});

app.listen(port, () => {
  console.log(`LangChain server listening on http://localhost:${port}`);
});
