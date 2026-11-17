import { ToolMessage, type BaseMessage } from "@langchain/core/messages";
import { tool } from "@langchain/core/tools";

type SimpleTool = {
  invoke: (input: unknown) => Promise<string>;
  name: string;
};
interface CreateRequestParams {
  action: string;
  resource: string;
  values?: Record<string, unknown>;
}

const createRequestJsonSchema = {
  type: "object",
  properties: {
    action: { type: "string" },
    resource: { type: "string" },
    values: { type: "object", additionalProperties: true },
  },
  required: ["action", "resource"],
  additionalProperties: false,
} as const;

const sonifyGraphJsonSchema = {
  type: "object",
  properties: {
    graphID: { type: "integer" },
  },
  required: ["graphID"],
  additionalProperties: false,
} as const;

/**
 * Normalize the arguments for a tool invocation. This function will attempt to parse and
 * structure the raw arguments into the correct format since LLMs sometimes use incorrect
 * formats intermittently.
 * @param args The raw arguments to normalize.
 * @returns The normalized arguments.
 */
const normalizeArgs = <T>(args: unknown): Partial<T> => {
  try {
    let a: unknown = args;
    if (typeof a === "string") a = JSON.parse(a);
    if (typeof a !== "object" || a === null) {
      return { value: a } as unknown as Partial<T>;
    }
    if ("input" in (a as Record<string, unknown>)) {
      const inputVal = (a as Record<string, unknown>).input;
      if (typeof inputVal === "string") return normalizeArgs<T>(JSON.parse(inputVal));
      if (typeof inputVal === "object" && inputVal !== null) return normalizeArgs<T>(inputVal);
    }
    return a as Partial<T>;
  } catch {
    return {};
  }
};

const coerceGraphIdtoInteger = (v: unknown): number => {
  if (typeof v === "number" && Number.isInteger(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return Math.trunc(n);
  }

  throw new Error("Invalid or missing graphID");
};

export const createRequestTool = tool(
  async (rawArgs: unknown) => {
    try {
      const args = normalizeArgs<CreateRequestParams>(rawArgs);
      const { action, resource, values } = args;
      return JSON.stringify({ action, resource, values });
    } catch (error) {
      return JSON.stringify({
        status: "error",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },
  {
    name: "create_request",
    description: "Create a request to send to the CODAP Data Interactive API",
    schema: createRequestJsonSchema as any,
  }
);

export const sonifyGraphTool = tool(
  async (rawArgs: unknown) => {
    try {
      const args = normalizeArgs<{ graphID?: unknown; value?: unknown }>(rawArgs);
      const graphID = args.graphID ?? args.value;
      const finalGraphID = coerceGraphIdtoInteger(graphID);
      return JSON.stringify({ graphID: finalGraphID });
    } catch (error) {
      return JSON.stringify({
        status: "error",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },
  {
    name: "sonify_graph",
    description: "Sonify the graph requested by the user",
    schema: sonifyGraphJsonSchema as any,
  }
);

export const tools: SimpleTool[] = [createRequestTool as any, sonifyGraphTool as any];

export const toolCallResponse = async (toolCall: any) => {
  try {
    const definedTool = tools.find((t) => t.name === toolCall.name);
    if (!definedTool) throw new Error(`Tool ${toolCall.name} not found`);

    const toolResult = await (definedTool as any).invoke(toolCall.args);
    const parsedResult = JSON.parse(toolResult);

    return {
      request: parsedResult,
      status: "requires_action",
      tool_call_id: toolCall.id,
      type: definedTool.name,
    };
  } catch (error) {
    // A tool_use MUST be answered by a tool_result or the Anthropic thread is left
    // permanently broken (INVALID_TOOL_RESULTS). Throwing here would skip the client's
    // tool round-trip and orphan the tool_use. Instead return an answerable error
    // response: the client forwards it back as the tool result and the model recovers.
    const message = error instanceof Error ? error.message : String(error);
    return {
      request: { status: "error", error: message },
      status: "requires_action",
      tool_call_id: toolCall?.id,
      type: toolCall?.name ?? "unknown",
    };
  }
};

export const extractToolCalls = (lastMessage: BaseMessage | undefined): any[] => {
  if (!lastMessage || !("tool_calls" in lastMessage) || !Array.isArray((lastMessage as any).tool_calls)) {
    return [];
  }
  return (lastMessage as any).tool_calls;
};

/**
 * Find tool_call ids in the thread that were never answered by a ToolMessage.
 * Anthropic rejects any thread where a tool_use lacks a following tool_result, so
 * these are the ids the server must synthesize results for. Order = first
 * appearance; duplicates removed. Pure: accepts plain message-shaped objects.
 */
export function getUnansweredToolCallIds(messages: BaseMessage[]): string[] {
  const answered = new Set<string>();
  for (const message of messages) {
    const toolCallId = (message as any).tool_call_id;
    if (typeof toolCallId === "string") answered.add(toolCallId);
  }

  const unanswered: string[] = [];
  const seen = new Set<string>();
  for (const message of messages) {
    const toolCalls = (message as any).tool_calls;
    if (!Array.isArray(toolCalls)) continue;
    for (const toolCall of toolCalls) {
      const id = toolCall?.id;
      if (typeof id === "string" && !answered.has(id) && !seen.has(id)) {
        seen.add(id);
        unanswered.push(id);
      }
    }
  }
  return unanswered;
}

export const TOOL_NOT_COMPLETED_ERROR =
  "The previous tool call did not complete and produced no result.";

/**
 * Synthesize an error tool_result (ToolMessage) for every tool_use in the thread
 * that was never answered, so the next model call satisfies Anthropic's
 * "every tool_use needs a tool_result" rule. Pass the id the current tool-job is
 * already answering as `answeringToolCallId` so it is not double-answered.
 */
export function buildToolRepairMessages(
  priorMessages: BaseMessage[],
  answeringToolCallId?: string
): ToolMessage[] {
  return getUnansweredToolCallIds(priorMessages)
    .filter((id) => id !== answeringToolCallId)
    .map((id) =>
      new ToolMessage({
        tool_call_id: id,
        content: JSON.stringify({ status: "error", error: TOOL_NOT_COMPLETED_ERROR }),
      })
    );
}
