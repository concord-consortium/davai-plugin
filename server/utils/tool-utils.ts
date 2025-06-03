import { DynamicStructuredTool } from "langchain/tools";
import { z } from "zod";

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

export const tools = [createRequestTool, sonifyGraphTool];
