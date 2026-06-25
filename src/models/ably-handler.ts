import * as Ably from "ably";

export interface IToolCallProcessor {
  processToolCall: (input: { type: "create_request"; tool_call_id: string, request: any }) => Promise<any>;
}

export function setupAblyHandler(assistantModel: IToolCallProcessor) {

  const api_key = process.env.ABLY_API_KEY;
  if (!api_key) {
    throw new Error("ABLY_API_KEY environment variable is required");
  }
  const client = new Ably.Realtime(api_key);
  const channel = client.channels.get("codap-demo");

  channel.subscribe("codap-request", async (message) => {
    const data = JSON.parse(message.data);
    console.log("Received codap-request via Ably:", data);

    const { call_id, request } = data;

    let result, error, ok = true;
    try {
      result = await assistantModel.processToolCall({
        type: "create_request",
        tool_call_id: call_id,
        request
      });
    } catch (e) {
      ok = false;
      error = String(e);
    }

    const response = {
      type: "codap-response",
      call_id,
      ok,
      result,
      error,
    };

    console.log("Publishing response to codap-request via Ably:", response);

    channel.publish("codap-response", JSON.stringify(response));
  });

  return () => {
    channel.unsubscribe();
    client.close();
  };
}
