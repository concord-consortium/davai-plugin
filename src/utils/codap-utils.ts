import { codapInterface, getAttribute } from "@concord-consortium/codap-plugin-api";
import { AssistantTool } from "openai/resources/beta/assistants";

export const openAiTools: AssistantTool[] = [
  {
    type: "function",
    function: {
      name: "get_attributes",
      description: "Get a list of all attributes in a dataset",
      strict: true,
      parameters: {
        type: "object",
        properties: {
          dataset: {
            type: "string",
            description: "The specified dataset containing attributes"
          }
        },
        additionalProperties: false,
        required: [
          "dataset"
        ]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "create_graph",
      description: "Create a graph tile in CODAP",
      strict: true,
      parameters: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "A name for the graph"
          },
          xAttribute: {
            type: "string",
            description: "The x-axis attribute"
          },
          yAttribute: {
            type: "string",
            description: "The y-axis attribute"
          },
        },
        additionalProperties: false,
        required: [
          "name",
          "xAttribute",
          "yAttribute"
        ]
      }
    }
  }
];

export const getCodapAttribute = async (dataContextName: string, collectionName: string, attributeName: string) => {
  const attribute = await getAttribute(dataContextName, collectionName, attributeName);
  return attribute;
};

export const createGraph = async (dataContext: any, graphName: string, xAttribute: string, yAttribute: string) => {
  const graph = {
    "action": "create",
    "resource": "component",
    "values": {
      "type": "graph",
      "name": graphName,
      "dataContext": dataContext.values.name,
      "xAttributeName": xAttribute,
      "yAttributeName": yAttribute
    }
  };
  
  return await codapInterface.sendRequest(graph);
};
