import express, { json } from "express";
import * as dotenv from "dotenv";
import { HumanMessage, ToolMessage } from "@langchain/core/messages";
import { buildResponse, langApp } from "./utils/llm-utils.js";

dotenv.config();

const app = express();
const port = 3000;
app.use(json());

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
const activeMessages = new Map<string, AbortController>();

app.post("/default/davaiServer/tool", async (req, res) => {
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
  const { llmId, message, dataContexts, graphs, threadId, messageId } = req.body;
  const config = { configurable: { thread_id: threadId, llmId } };

  try {
    // Create an AbortController for this request. This lets us cancel the request if needed.
    const controller = new AbortController();
    activeMessages.set(messageId, controller);

    // pass the user message and fresh CODAP data to langApp
    // the CODAP data will be added to the prompt template
    const output = await langApp.invoke(
      {
        messages: [new HumanMessage({ content: message })],
        dataContexts: dataContexts || {},
        graphs: graphs || []
      },
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


app.listen(port, () => {
  console.log(`LangChain server listening on http://localhost:${port}`);
});

export default app;
