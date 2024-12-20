import { AssistantTool } from "openai/resources/beta/assistants";

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
