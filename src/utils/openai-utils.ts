import { OpenAI } from "openai";
import { AssistantTool } from "openai/resources/beta/assistants";

export const newOpenAI = () => {
  return new OpenAI({
    apiKey: process.env.REACT_APP_OPENAI_API_KEY || "fake-key",
    baseURL: process.env.REACT_APP_OPENAI_BASE_URL,
    dangerouslyAllowBrowser: true,
    organization: "org-jbU1egKECzYlQI73HMMi7EOZ",
    project: "proj_VsykADfoZHvqcOJUHyVAYoDG",
  });
};

export const openAiTools: AssistantTool[] = [
  {
    type: "function",
    function: {
      name: "create_request",
      description: "Create a request to get data from CODAP",
      strict: false,
      parameters: {
        type: "object",
        properties: {
          action: {
            type: "string",
            description: "The action to perform"
          },
          resource: {
            type: "string",
            description: "The resource to act upon"
          },
          values: {
            type: "object",
            description: "The values to pass to the action"
          }
        },
        additionalProperties: false,
        required: [
          "action",
          "resource"
        ]
      }
    }
  },
];
