import express from "express";
import dotenv from "dotenv";
import { START, END, MemorySaver, MessagesAnnotation, StateGraph } from "@langchain/langgraph";
import { AIMessage, trimMessages } from "@langchain/core/messages";
import { ChatOpenAI } from "@langchain/openai";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { MemoryVectorStore } from "langchain/vectorstores/memory";
import { Document } from "@langchain/core/documents";
import { instructions } from "./instructions.js";
import { codapApiDoc } from "./codap-api-documentation.js";
import { processMarkdownDoc, setupVectorStore } from "./utils/rag-utils.js";
import { tools } from "./utils/tool-utils.js";

dotenv.config();
const app = express();
const port = 5000;
let vectorStoreCache: { [key: string]: MemoryVectorStore } = {};

app.use(express.json());

// Process the CODAP Plugin API documentation content and add it to the prompt template.
const processedCodapApiDoc = await processMarkdownDoc(codapApiDoc);

const openAiModel = new ChatOpenAI({
  model: "gpt-4o-mini",
  temperature: 0,
  apiKey: process.env.OPENAI_API_KEY,
}).bind({ tools });

const geminiModel = new ChatGoogleGenerativeAI({
  model: "gemini-2.0-flash",
  temperature: 0,
  apiKey: process.env.GOOGLE_API_KEY,
}).bind({ tools });

// We can use the trimMessages helper to reduce how many messages we're sending to the model.
// const trimmer = trimMessages({
//   maxTokens: 10,
//   strategy: "last",
//   tokenCounter: (msgs) => msgs.length,
//   includeSystem: true,
//   allowPartial: false,
//   startOn: "human",
// });

// add this into callModel?
// await trimmer.invoke(messages);

// This is a previous version of the prompt template that included the CODAP API document content directly.
// const promptTemplate = ChatPromptTemplate.fromMessages([
//   ["system", instructions],
//   ["system", processedCodapApiDoc.map(chunk => chunk.pageContent).join("\n\n")],
//   ["placeholder", "{messages}"],
// ]);

const promptTemplate = ChatPromptTemplate.fromMessages([
  ["system", instructions],
  ["system", "Here is the relevant CODAP API documentation:\n{context}"],
  ["placeholder", "{messages}"],
]);

const callModel = async (state: any, modelConfig: any) => {
  const { assistantId } = modelConfig.configurable;
  const llm = assistantId === "gemini" ? geminiModel : openAiModel;

  // Get the last user message to use as the query
  const lastUserMessage = state.messages
    .filter((msg: any) => msg.role === "user")
    .pop()?.content || state.messages[0]?.content;  // Fallback to first message if no user message

  if (!lastUserMessage) {
    console.error("No message content found in state:", state);
    throw new Error("No message content found");
  }

  // Retrieve relevant documents using the appropriate embeddings
  const vectorStore = await setupVectorStore(processedCodapApiDoc, assistantId, vectorStoreCache);
  // console.log("Vector store created/retrieved");
  
  const relevantDocs = await vectorStore.similaritySearch(lastUserMessage, 3);
  // console.log("Relevant docs found:", relevantDocs.length);
  
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
  // console.log("Context created:", context);

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

// This is the main endpoint for use by the client app.
app.post("/api/message", async (req, res) => {
  const { assistantId, message, threadId, isSystemMessage, isToolResponse } = req.body;
  const config = { configurable: { thread_id: threadId, assistantId } };

  try {
    // isToolResponse should only be true if the message from the client is the response to a CODAP API request that
    // the client made in response to a CODAP_REQUEST message from the LLM.
    // Although the client is now properly receiving CODAP_REQUEST messages, and sending back valid CODAP API responses,
    // the code below is not yet correctly passing that information back to the LLM.
    if (isToolResponse) {
      console.log("Processing tool response", message.tool_call_id);
      const toolResponse = new AIMessage({
        content: message.content,
        additional_kwargs: {
          tool_call_id: message.tool_call_id,
          role: "tool"
        }
      });

      const output = await langApp.invoke({ messages: [toolResponse] }, config);
      res.json({ response: output.messages[output.messages.length - 1].content });
    } else {
      console.log("Processing regular message");
      const input = isSystemMessage ? [{ role: "system", content: message }] : [{ role: "user", content: message }];
      console.log("Input messages:", input);
      const output = await langApp.invoke({ messages: input }, config);
      const lastMessage = output.messages[output.messages.length - 1];
      const functionCall = (lastMessage && "tool_calls" in lastMessage && Array.isArray((lastMessage as any).tool_calls))
        ? (lastMessage as any).tool_calls[0]
        : undefined;
      
      if (functionCall) {
        const tool = tools.find(t => t.name === functionCall.name);
        if (!tool) {
          throw new Error(`Tool ${functionCall.name} not found`);
        }

        const toolResult = await tool.func(functionCall.args);
        const parsedResult = JSON.parse(toolResult);
        const response = { 
          type: parsedResult.type,
          request: parsedResult.request,
          tool_call_id: functionCall.id
        };

        res.json(response);
      } else {
        res.json({ response: lastMessage.content });
      }
    }
  } catch (err: any) {
    console.error("Error in /api/message:", err);
    console.error("Error stack:", err.stack);
    res.status(500).json({ error: "LangChain Error", details: err.message });
  }
});

app.listen(port, () => {
  console.log(`LangChain server listening on http://localhost:${port}`);
});
