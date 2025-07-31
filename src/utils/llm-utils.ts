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
  // return await fetch(`${serverUrl}default/davaiServer/${msgEndpoint}`, {
  //   method,
  //   headers: {
  //     "Content-Type": "application/json",
  //     "Authorization": process.env.AUTH_TOKEN || "",
  //   },
  //   body: JSON.stringify(req),
  // });

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
