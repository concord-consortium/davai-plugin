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

const CHUNK_SIZE = 4000;

function chunkDataContexts(contexts: any[]): any[][] {
  const chunks: any[][] = [];
  let currentChunk: any[] = [];
  let currentSize = 0;

  for (const context of contexts) {
    const contextStr = JSON.stringify(context);
    // Conservative token estimate (3 chars ≈ 1 token)
    const estimatedTokens = contextStr.length / 3;

    if (currentSize + estimatedTokens > CHUNK_SIZE) {
      if (currentChunk.length > 0) {
        chunks.push(currentChunk);
        currentChunk = [];
        currentSize = 0;
      }
      // If a single context is too large, split it into smaller pieces
      if (estimatedTokens > CHUNK_SIZE) {
        const subContexts = splitLargeContext(context);
        chunks.push(...subContexts);
        continue;
      }
    }
    currentChunk.push(context);
    currentSize += estimatedTokens;
  }

  if (currentChunk.length > 0) {
    chunks.push(currentChunk);
  }

  return chunks;
}

function splitLargeContext(context: any): any[][] {
  const chunks: any[][] = [];
  
  // Get the collections array from the context
  const collections = context.context?.collections;
  if (!collections || !Array.isArray(collections) || collections.length === 0) {
    console.log("No collections found, sending whole context");
    chunks.push([context]);
    return chunks;
  }

  // Get the first collection
  const firstCollection = collections[0];
  
  // Get the attributes from the collection
  const attributes = firstCollection.attrs;
  if (!attributes || !Array.isArray(attributes)) {
    console.log("No attributes found in collection, sending whole context");
    chunks.push([context]);
    return chunks;
  }

  // Calculate how many attributes we can fit in each chunk
  // We'll aim for 3500 tokens per chunk to leave room for metadata
  const attrsPerChunk = Math.floor(3500 / (JSON.stringify(attributes[0]).length / 3));
  console.log(`Splitting ${attributes.length} attributes into chunks of ${attrsPerChunk} attributes each`);

  // Split the attributes into chunks
  for (let i = 0; i < attributes.length; i += attrsPerChunk) {
    const chunkAttrs = attributes.slice(i, i + attrsPerChunk);
    const chunk = [{
      name: context.name,
      context: {
        ...context.context,
        collections: [{
          ...firstCollection,
          attrs: chunkAttrs
        }]
      }
    }];

    // Log the size of each chunk
    const chunkSize = JSON.stringify(chunk).length / 3;
    console.log(`Chunk ${i / attrsPerChunk + 1} size: ${chunkSize} tokens`);
    
    chunks.push(chunk);
  }

  return chunks;
}

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
    .pop()?.content || state.messages[0]?.content;

  // Retrieve relevant documents using the appropriate embeddings
  const vectorStore = await setupVectorStore(processedCodapApiDoc, llmRealId, vectorStoreCache);
  const relevantDocs = await vectorStore.similaritySearch(lastUserMessage, 3);
  
  // Clean the context to ensure it doesn't contain any template variables
  const context = relevantDocs
    .map((doc: Document) => {
      return doc.pageContent.replace(/```json\n([\s\S]*?)\n```/g, (match) => {
        return match
          .replace(/{/g, "{{")
          .replace(/}/g, "}}");
      });
    })
    .join("\n\n");

  const prompt = await promptTemplate.invoke({
    context,
    messages: state.messages
  });

  const response = await llm.invoke(prompt);

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
  const { llmId, message, threadId, dataContexts } = req.body;
  const config = { configurable: { thread_id: threadId, llmId } };

  try {
    const messages = [];

    // If we have data contexts, process them first
    if (dataContexts && typeof dataContexts === "object") {
      console.log("Processing data contexts");
      
      const contextsArray = Object.entries(dataContexts).map(([name, context]) => {
        const contextSize = JSON.stringify(context).length / 3;
        console.log(`Processing context ${name}, size: ${contextSize} tokens`);
        return {
          name,
          context: context as Record<string, any>
        };
      });
      
      const chunks = chunkDataContexts(contextsArray);
      console.log(`Created ${chunks.length} chunks`);
      
      // Process chunks and add them as user messages
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const chunkStr = JSON.stringify(chunk);
        const chunkSize = chunkStr.length / 3;
        console.log(`Processing chunk ${i + 1}/${chunks.length}, size: ${chunkSize} tokens`);
        
        // For chunks that are still too large, split them further
        if (chunkSize > 7000) {
          console.log(`Chunk ${i + 1} too large (${chunkSize} tokens), splitting further...`);
          const subChunks = splitLargeContext(chunk[0]);
          for (const subChunk of subChunks) {
            const subChunkStr = JSON.stringify(subChunk);
            const subChunkSize = subChunkStr.length / 3;
            console.log(`Sub-chunk size: ${subChunkSize} tokens`);
            messages.push({ 
              role: "user", 
              content: `Data context sub-chunk: ${subChunkStr}` 
            });
          }
        } else {
          messages.push({ 
            role: "user", 
            content: `Data contexts chunk ${i + 1}/${chunks.length}: ${chunkStr}` 
          });
        }
      }
    }

    // Add the user's message
    messages.push({ 
      role: "user", 
      content: message 
    });

    console.log("Final messages array:", messages.map(m => ({ role: m.role, contentLength: m.content.length })));

    const output = await langApp.invoke({ messages }, config);
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
