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

// export const sonify_graph = {
//   "name": "sonify_graph",
//   "description": "Sonify the graph requested by the user",
//   "strict": true,
//   "parameters": {
//     "type": "object",
//     "properties": {
//       "graphID": {
//         "type": "number",
//         "description": "The id of the graph to sonify"
//       }
//     },
//     "additionalProperties": false,
//     "required": [
//       "graphID"
//     ]
//   }
// };

export const tools = [createRequestTool];
