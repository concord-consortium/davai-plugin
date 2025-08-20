import { BaseMessage } from "@langchain/core/messages";
import { tool } from "@langchain/core/tools";

// interface CreateRequestParams {
//   action: string;
//   resource: string;
//   values?: Record<string, any>;
// }

export const createRequestTool = tool(
  async (args: any) => {
    try {
      let action: string;
      let resource: string;
      let values: Record<string, any>;
      
      // FIXME: Ideally the LLM would just send action, resource, and values as the args. Instead, it's sometimes sending
      // an object with an `input` param whose value is an object containing the action, resource, and values.
      if (typeof args === "string") {
        args = JSON.parse(args);
        action = args.action;
        resource = args.resource;
        values = args.values;
      } else if (args.input && typeof args.input === "string") {
        const inputData = JSON.parse(args.input);
        action = inputData.action;
        resource = inputData.resource;
        values = inputData.values;
      } else if (args.input && typeof args.input === "object") {
        action = args.input.action;
        resource = args.input.resource;
        values = args.input.values;
      } else if (args.action) {
        action = args.action;
        resource = args.resource;
        values = args.values;
      } else {
        throw new Error("No action, resource, or values provided");
      }

      // Handle some LLM's tendency to wrap values in a 'data' property
      if (values && values.data && typeof values.data === "object") {
        // Extract properties from the nested 'data' object and merge them with the top-level values
        const { data, ...otherValues } = values;
        values = { ...data, ...otherValues };
      }

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
    description: "Create a request to send to the CODAP Data Interactive API"
  }
);

export const sonifyGraphTool = tool(
  async (args: any) => {
    try {
      // FIXME: Ideally the LLM would just send the graphID as a number. Instead, it's sometimes sending
      // an object with an `input` param whose value is the graph ID.
      let graphID: number;
      if (args.input && typeof args.input === "string") {
        const inputData = JSON.parse(args.input);
        graphID = inputData.graphID;
      } else if (args.input && typeof args.input === "object") {
        graphID = parseInt(args.input.graphID, 10);
      } else if (args.graphID) {
        graphID = parseInt(args.graphID, 10);
      } else if (typeof args === "number") {
        graphID = args;
      } else if (typeof args === "string") {
        args = JSON.parse(args);
        graphID = args.graphID || args;
      } else {
        throw new Error("No graphID provided");
      }
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
    description: "Sonify the graph requested by the user"
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
