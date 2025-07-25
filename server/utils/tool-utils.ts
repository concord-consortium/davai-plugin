import { BaseMessage } from "@langchain/core/messages";
import { tool } from "@langchain/core/tools";
import { z } from "zod";

interface CreateRequestParams {
  action: string;
  resource: string;
  values?: Record<string, any>;
}

const createRequestSchema = z.object({
  action: z.string().describe("The action to perform"),
  resource: z.string().describe("The resource to act upon"),
  values: z.record(z.any()).optional().describe("The values to pass to the action")
});

export const createRequestTool = tool(
  async ({ action, resource, values }: CreateRequestParams) => {
    try {
      const request = { action, resource, values };
      return JSON.stringify(request);
    } catch (error) {
      return JSON.stringify({
        status: "error",
        error: error instanceof Error ? error.message : String(error)
      });
    }
  },
  {
    name: "create_request",
    description: "Create a request to send to the CODAP Data Interactive API",
    schema: createRequestSchema
  }
);

const sonifyGraphSchema = z.object({
  graphID: z.number().describe("The id of the graph to sonify")
});

export const sonifyGraphTool = tool(
  async ({ graphID }: { graphID: number }) => {
    try {
      return JSON.stringify({ graphID });
    } catch (error) {
      return JSON.stringify({
        status: "error",
        error: error instanceof Error ? error.message : String(error)
      });
    }
  },
  {
    name: "sonify_graph",
    description: "Sonify the graph requested by the user",
    schema: sonifyGraphSchema
  }
);

export const tools = [createRequestTool, sonifyGraphTool];

export const toolCallResponse = async (toolCall: any) => {
  const definedTool = tools.find(t => t.name === toolCall.name);

  if (!definedTool) {
    throw new Error(`Tool ${toolCall.name} not found`);
  }

  const toolResult = await definedTool.func(toolCall.args);
  const parsedResult = JSON.parse(toolResult);

  return {
    request: parsedResult,
    status: "requires_action",
    tool_call_id: toolCall.id,
    type: definedTool.name
  };
};

export const extractToolCalls = (lastMessage: BaseMessage | undefined): any[] => {
  if (!lastMessage || !("tool_calls" in lastMessage) || !Array.isArray((lastMessage as any).tool_calls)) {
    return [];
  }

  return (lastMessage as any).tool_calls;
};
