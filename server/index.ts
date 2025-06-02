import express from "express";
import dotenv from "dotenv";
import { START, END, MemorySaver, MessagesAnnotation, StateGraph } from "@langchain/langgraph";
import { AIMessage, trimMessages } from "@langchain/core/messages";
import { ChatOpenAI } from "@langchain/openai";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { MarkdownTextSplitter, RecursiveCharacterTextSplitter } from "langchain/text_splitter";
import { DynamicStructuredTool } from "langchain/tools";
import { z } from "zod";
import { codapApiDoc } from "./instructions.js";

dotenv.config();
const app = express();
const port = 5000;

app.use(express.json());

// This is used to ensure the CODAP Plugin API documentation Markdown is properly formatted.
function escapeCurlyBraces(text: string): string {
  // Handle any existing escaped braces to avoid double escaping
  text = text.replace(/\\{/g, "{").replace(/\\}/g, "}");
  
  // Handle comments with braces
  text = text.replace(/\/\*.*?\*\//g, (match) => {
    return match.replace(/{/g, "{{").replace(/}/g, "}}");
  });
  
  // Handle inline code blocks with braces
  text = text.replace(/`.*?`/g, (match) => {
    return match.replace(/{/g, "{{").replace(/}/g, "}}");
  });
  
  // Handle JSON-like objects that aren't part of template variables
  text = text.replace(/(?<!\\){([^{}]*?)(?<!\\)}/g, "{{$1}}");
  
  // Handle any remaining single braces
  text = text.replace(/(?<!\\){/g, "{{");
  text = text.replace(/(?<!\\)}/g, "}}");
  
  return text;
}

// Splits by markdown headers
const markdownSplitter = new MarkdownTextSplitter({
  chunkSize: 1000,
  chunkOverlap: 200,
});

// For any chunks that are too large, use recursive character splitter
const recursiveSplitter = new RecursiveCharacterTextSplitter({
  chunkSize: 500,
  chunkOverlap: 50,
  separators: ["\n\n", "\n", ".", "!", "?", ",", " ", ""],
});

async function processInstructions(instructionsString: string) {
  const escapedInstructions = escapeCurlyBraces(instructionsString);
  const markdownChunks = await markdownSplitter.createDocuments([escapedInstructions]);

  const processedChunks = await Promise.all(
    markdownChunks.map(async (chunk) => {
      // If chunk is too large, split it further
      if (chunk.pageContent.length > 1000) {
        const subChunks = await recursiveSplitter.createDocuments([chunk.pageContent]);
        return subChunks;
      }
      return [chunk];
    })
  );

  return processedChunks.flat();
}

// Process the CODAP Plugin API documentation content and add it to the prompt template.
const processedInstructions = await processInstructions(codapApiDoc);

// Define the tool functions
const createRequestTool = new DynamicStructuredTool({
  name: "create_request",
  description: "Create a request to send to the CODAP Data Interactive API",
  schema: z.object({
    action: z.string().describe("The action to perform"),
    resource: z.string().describe("The resource to act upon"),
    values: z.object({}).optional().describe("The values to pass to the action")
  }),
  func: async ({ action, resource, values }) => {
    return JSON.stringify({
      type: "CODAP_REQUEST",
      request: { action, resource, values }
    });
  }
});

const sonifyGraphTool = new DynamicStructuredTool({
  name: "sonify_graph",
  description: "Sonify the graph requested by the user",
  schema: z.object({
    graphID: z.number().describe("The id of the graph to sonify")
  }),
  func: async ({ graphID }) => {
    return JSON.stringify({
      type: "SONIFICATION_REQUEST",
      request: { graphID }
    });
  }
});

const tools = [createRequestTool, sonifyGraphTool];

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

// move this into callModel?
// await trimmer.invoke(messages);

const promptTemplate = ChatPromptTemplate.fromMessages([
  ["system", processedInstructions.map(chunk => chunk.pageContent).join("\n\n")],
  ["placeholder", "{messages}"],
]);

const callModel = async (state: any, modelConfig: any) => {
  const { assistantId } = modelConfig.configurable;
  const llm = assistantId === "gemini" ? geminiModel : openAiModel;
  const prompt = await promptTemplate.invoke(state);
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

// This version does not include an initial prompt
// const callModel = async (state: any, modelConfig: any) => {
//   const { assistantId } = modelConfig.configurable;
//   // Shouldn't we strip out the assistantId?
//   // const callConfig = { configurable: { thread_id: _config.thread_id } };
//   const llm = assistantId === "gemini" ? geminiModel : openAiModel;
//   const response = await llm.invoke(state.messages, modelConfig);
//   return { messages: response };
// };

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
      const input = isSystemMessage
        ? [message]
        : [{ role: "user", content: message }];
      
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
    res.status(500).json({ error: "LangChain Error", details: err.message });
  }
});

app.listen(port, () => {
  console.log(`LangChain server listening on http://localhost:${port}`);
});
