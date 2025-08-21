import type { BaseMessage } from "@langchain/core/messages";
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
};

export const extractToolCalls = (lastMessage: BaseMessage | undefined): any[] => {
  if (!lastMessage || !("tool_calls" in lastMessage) || !Array.isArray((lastMessage as any).tool_calls)) {
    return [];
  }
  return (lastMessage as any).tool_calls;
};
