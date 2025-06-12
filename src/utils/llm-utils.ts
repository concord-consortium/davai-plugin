const serverUrl = process.env.LANGCHAIN_SERVER_URL || "http://localhost:5000/";
const msgEndpoint = `${serverUrl}message`;

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

export async function postMessage(req: Record<string, any>) {
  await fetch(msgEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": process.env.AUTH_TOKEN || "",
    },
    body: JSON.stringify(req),
  });
}