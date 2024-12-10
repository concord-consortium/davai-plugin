import { Anthropic } from "@anthropic-ai/sdk";

export const newAnthropic = () => {
  return new Anthropic({
    apiKey: process.env.REACT_APP_ANTHROPIC_API_KEY,
  });
};

export const anthropicTools = [
  {
    name: "get_attributes",
    description: "Get the current weather in a given location",
    input_schema: {
      type: "object",
      properties: {
        dataset: {
          type: "string",
          description: "The specified dataset containing attributes"
        }
      },
      required: [
        "dataset"
      ]
    }
  },
  {
    name: "create_graph",
    description: "Create a graph tile in CODAP",
    input_schema: {
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
        }
      },
      required: [
        "name",
        "xAttribute",
        "yAttribute"
      ]
    }
  }
];
