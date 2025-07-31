const serverUrl = process.env.LANGCHAIN_SERVER_URL || "http://localhost:3000/";

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

export async function postMessage(req: Record<string, any>, msgEndpoint: string, method = "POST") {
  const url = `${serverUrl}default/davaiServer/${msgEndpoint}`;
  const opts: RequestInit = {
    method,
    headers: {
      "Content-Type": "application/json",
      "Authorization": process.env.AUTH_TOKEN || ""
    }
  };

  if (req && method !== "GET") {
    opts.body = JSON.stringify(req);
  }

  return await fetch(url, opts);
}

export const getParsedData = (toolCall: any) => {
  try {
    const data = JSON.parse(toolCall.function.arguments);
    return { ok: true, data };
  } catch {
    return { ok: false, data: null };
  }
};

export const convertBase64ToImage = async (base64Data: string, filename = "image.png") => {
  try {
    const mimeType = base64Data.match(/data:(.*?);base64/)?.[1] || "image/png";
    const base64 = base64Data.split(",")[1];
    const binary = atob(base64);
    const binaryLength = binary.length;
    const arrayBuffer = new Uint8Array(binaryLength);
    for (let i = 0; i < binaryLength; i++) {
      arrayBuffer[i] = binary.charCodeAt(i);
    }

    const blob = new Blob([arrayBuffer], { type: mimeType });
    const file = new File([blob], filename, { type: mimeType });
    return file;
  } catch (error) {
    console.error("Error converting base64 to image:", error);
    throw error;
  }
};
