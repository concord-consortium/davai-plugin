import { OpenAI } from "openai";
import { AssistantTool } from "openai/resources/beta/assistants";

export const newOpenAI = () => {
  return new OpenAI({
    apiKey: process.env.REACT_APP_OPENAI_API_KEY,
    dangerouslyAllowBrowser: true,
    organization: "org-jbU1egKECzYlQI73HMMi7EOZ",
    project: "proj_VsykADfoZHvqcOJUHyVAYoDG",
  });
};

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
          dataset: {
            type: "string",
            description: "The name of the dataset to which the attributes belong"
          },
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
          "dataset",
          "name",
          "xAttribute",
          "yAttribute"
        ]
      }
    }
  }
];
