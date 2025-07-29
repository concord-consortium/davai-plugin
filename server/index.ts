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

// Track active conversations (not just individual requests)
const activeConversations = new Map<string, AbortController>();

app.post("/default/davaiServer/tool", async (req, res) => {
  const { llmId, message, threadId, messageId } = req.body;
  const config = { configurable: { thread_id: threadId, llmId } };

  try {
    // Check if this conversation was cancelled
    const controller = activeConversations.get(messageId);
    if (!controller) {
      return res.status(200).json({
        status: "cancelled",
        message: "Conversation was cancelled",
        messageId
      });
    }
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

    const toolResponseOutput = await langApp.invoke({ messages }, {
      ...config,
      signal: controller.signal
    });

    // There may be a follow-on tool call in the response, so we need to check for that and handle it.
    const lastMessage = toolResponseOutput.messages[toolResponseOutput.messages.length - 1];
    const response = await buildResponse(lastMessage);

    // If this is a final response (no more tool calls needed), clean up the conversation
    if (!("status" in response) || response.status !== "requires_action") {
      activeConversations.delete(messageId);
    }

    res.json(response);
  } catch (err: any) {
    if (err.message === "Aborted") {
      // Tool call was cancelled
      activeConversations.delete(messageId);
      res.status(200).json({
        status: "cancelled",
        message: "Tool call was cancelled",
        messageId
      });
    } else {
      console.error("Error in tool call:", err);
      console.error("Error stack:", err.stack);
      res.status(500).json({ error: "LangChain Error", details: err.message });
    }
  }
});

// This is the main endpoint for use by the client app. We may want to add more, e.g. another for tool calls, etc.
app.post("/default/davaiServer/message", async (req, res) => {
  const { llmId, message, dataContexts, graphs, threadId, messageId } = req.body;
  const config = { configurable: { thread_id: threadId, llmId } };

  try {
    // Create an AbortController for this request. This lets us cancel the request if needed.
    const controller = new AbortController();
    activeConversations.set(messageId, controller);

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

    const lastMessage = output.messages[output.messages.length - 1];
    const response = await buildResponse(lastMessage);

    // If this is a final response (no more tool calls needed), clean up the conversation
    if (!("status" in response) || response.status !== "requires_action") {
      activeConversations.delete(messageId);
    }

    res.json(response);
  } catch (err: any) {
    if (err.message === "Aborted") {
      // Successful cancellation - return 200, not 500
      res.status(200).json({
        status: "cancelled",
        message: "Message processing was successfully cancelled",
        messageId
      });
    } else {
      console.error("Error in /api/message:", err);
      console.error("Error stack:", err.stack);
      res.status(500).json({ error: "LangChain Error", details: err.message });
    }
    activeConversations.delete(messageId);
  }
});

// Endpoint for cancelling message processing
app.post("/default/davaiServer/cancel", async (req, res) => {
  const { messageId } = req.body;
  const controller = activeConversations.get(messageId);
  if (controller) {
    controller.abort();
    activeConversations.delete(messageId);
    res.json({
      status: "cancelled",
      messageId,
      message: "Message processing cancelled successfully"
    });
  } else {
    // Message not found could mean it already completed or never existed
    res.status(404).json({
      error: "Message not found or already completed",
      messageId,
      reason: "completed" // Message likely completed before cancellation request
    });
  }
});


app.listen(port, () => {
  console.log(`LangChain server listening on http://localhost:${port}`);
});

export default app;
