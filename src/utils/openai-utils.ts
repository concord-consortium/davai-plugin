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

export async function convertBase64ToImage(base64Data: string, filename = "image.png") {
  const base64 = base64Data.split(",")[1];

  const binary = atob(base64);
  const binaryLength = binary.length;
  const arrayBuffer = new Uint8Array(binaryLength);
  for (let i = 0; i < binaryLength; i++) {
    arrayBuffer[i] = binary.charCodeAt(i);
  }

  const blob = new Blob([arrayBuffer], { type: "image/png" });
  const file = new File([blob], filename, { type: "image/png" });
  return file;
}

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
  {
    type: "function",
    function: {
      name: "convert_base64_to_image",
      description: "Convert a base64 image to a file object",
      strict: false,
      parameters: {
        type: "object",
        properties: {
          base64Data: {
            type: "string",
            description: "The base64 image data"
          },
          filename: {
            type: "string",
            description: "The filename to use for the image"
          }
        },
        additionalProperties: false,
        required: [
          "base64Data"
        ]
      }
    }
  }
];

export const requestThreadDeletion = async (threadId: string): Promise<Response> => {
  const response = await fetch(`${process.env.REACT_APP_OPENAI_BASE_URL}threads/${threadId}`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${process.env.REACT_APP_OPENAI_API_KEY}`,
      "OpenAI-Beta": "assistants=v2",
      "Content-Type": "application/json",
    },
  });

  return response;
};
