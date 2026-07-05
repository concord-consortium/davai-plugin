import { IToolCallData, IToolRequest } from "../../types";

export type ParsedEnvelope =
  | { kind: "tool_call"; data: IToolCallData }
  | { kind: "final"; response: string }
  | { kind: "invalid"; raw: string; error: string };

// Qwen3 emits <think>…</think> when thinking mode leaks through; json_object grammar
// should prevent it, but strip defensively so a leak degrades instead of failing.
export const stripThink = (raw: string): string =>
  raw.replace(/<think>[\s\S]*?<\/think>/g, "").trim();

const extractJson = (raw: string): any => {
  try {
    return JSON.parse(raw);
  } catch {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(raw.slice(start, end + 1));
    }
    throw new Error("no JSON object found");
  }
};

export const parseEnvelope = (rawInput: string, callIndex: number): ParsedEnvelope => {
  const raw = stripThink(rawInput);
  let obj: any;
  try {
    obj = extractJson(raw);
  } catch (err) {
    return { kind: "invalid", raw, error: "Response was not a JSON object." };
  }

  if (obj?.tool === "final") {
    if (typeof obj.response !== "string" || !obj.response.length) {
      return { kind: "invalid", raw, error: "\"final\" requires a non-empty \"response\" string." };
    }
    return { kind: "final", response: obj.response };
  }
  if (obj?.tool === "create_request") {
    if (typeof obj.action !== "string" || typeof obj.resource !== "string") {
      return { kind: "invalid", raw, error: "\"create_request\" requires \"action\" and \"resource\" strings." };
    }
    return {
      kind: "tool_call",
      data: {
        type: "create_request",
        tool_call_id: `local-${callIndex}`,
        request: { action: obj.action, resource: obj.resource, values: obj.values },
      },
    };
  }
  if (obj?.tool === "sonify_graph") {
    if (obj.graphID === undefined || obj.graphID === null) {
      return { kind: "invalid", raw, error: "\"sonify_graph\" requires a \"graphID\"." };
    }
    return {
      kind: "tool_call",
      // `IToolRequest` declares `action`/`resource` as required, but the existing
      // "sonify_graph" consumer (assistant-model.ts) only ever reads `request.graphID`
      // and always receives its data via an `as IToolCallData` cast, never a structurally
      // checked literal — so this cast mirrors established, already-working behavior
      // rather than inventing fake action/resource values.
      data: {
        type: "sonify_graph",
        tool_call_id: `local-${callIndex}`,
        request: { graphID: String(obj.graphID) } as IToolRequest,
      },
    };
  }
  return { kind: "invalid", raw, error: "\"tool\" must be \"create_request\", \"sonify_graph\", or \"final\"." };
};
