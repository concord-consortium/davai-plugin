import { AIMessage, BaseMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import { createRequestTool,
         sonifyGraphTool,
         tools,
         toolCallResponse,
         extractToolCalls,
         getUnansweredToolCallIds
       } from "./tool-utils";

describe("createRequestTool", () => {
  it("should return a JSON string with action, resource, and values", async () => {
    const params = { action: "create", resource: "dataset", values: { name: "test" } };
    const result = await createRequestTool.func(JSON.stringify(params)) as string;
    expect(JSON.parse(result)).toEqual(params);
  });

  it("should handle missing values", async () => {
    const params = { action: "delete", resource: "dataset" };
    const result = await createRequestTool.func(JSON.stringify(params)) as string;
    expect(JSON.parse(result)).toEqual({ ...params, values: undefined });
  });
});

describe("sonifyGraphTool", () => {
  it("should return a JSON string with graphID", async () => {
    const params = { graphID: 42 };
    const result = await sonifyGraphTool.func(JSON.stringify(params)) as string;
    expect(JSON.parse(result)).toEqual(params);
  });
});

describe("tools array", () => {
  it("should contain createRequestTool and sonifyGraphTool", () => {
    expect(tools).toContain(createRequestTool);
    expect(tools).toContain(sonifyGraphTool);
  });
});

describe("toolCallResponse", () => {
  it("should return correct response for createRequestTool", async () => {
    const toolCall = {
      name: "create_request",
      args: { action: "update", resource: "item", values: { id: 1 } },
      id: "abc123"
    };
    const response = await toolCallResponse(toolCall);
    expect(response).toMatchObject({
      request: { action: "update", resource: "item", values: { id: 1 } },
      status: "requires_action",
      tool_call_id: "abc123",
      type: "create_request"
    });
  });

  it("should throw error if tool not found", async () => {
    const toolCall = { name: "unknown_tool", args: {}, id: "xyz" };
    await expect(toolCallResponse(toolCall)).rejects.toThrow("Tool unknown_tool not found");
  });
});

describe("extractToolCalls", () => {
  it("should return tool_calls array if present", () => {
    const msg = { tool_calls: [{ name: "foo" }, { name: "bar" }] } as unknown as BaseMessage;
    expect(extractToolCalls(msg)).toEqual([{ name: "foo" }, { name: "bar" }]);
  });

  it("should return empty array if lastMessage is undefined", () => {
    expect(extractToolCalls(undefined)).toEqual([]);
  });

  it("should return empty array if tool_calls is not present", () => {
    const msg = {} as unknown as BaseMessage;
    expect(extractToolCalls(msg)).toEqual([]);
  });

  it("should return empty array if tool_calls is not an array", () => {
    const msg = { tool_calls: "not-an-array" } as unknown as BaseMessage;
    expect(extractToolCalls(msg)).toEqual([]);
  });
});

describe("getUnansweredToolCallIds", () => {
  it("returns a tool_call id that has no following ToolMessage", () => {
    const messages = [
      new HumanMessage({ content: "hi" }),
      new AIMessage({ content: "", tool_calls: [{ name: "create_request", args: {}, id: "call-1" }] }),
    ];
    expect(getUnansweredToolCallIds(messages)).toEqual(["call-1"]);
  });

  it("excludes tool calls that already have a matching ToolMessage", () => {
    const messages = [
      new AIMessage({ content: "", tool_calls: [{ name: "create_request", args: {}, id: "call-1" }] }),
      new ToolMessage({ content: "ok", tool_call_id: "call-1" }),
    ];
    expect(getUnansweredToolCallIds(messages)).toEqual([]);
  });

  it("returns only the still-unanswered ids from a multi-tool-call message, in order", () => {
    const messages = [
      new AIMessage({ content: "", tool_calls: [
        { name: "create_request", args: {}, id: "call-1" },
        { name: "sonify_graph", args: {}, id: "call-2" },
      ]}),
      new ToolMessage({ content: "ok", tool_call_id: "call-2" }),
    ];
    expect(getUnansweredToolCallIds(messages)).toEqual(["call-1"]);
  });

  it("returns [] for an empty history", () => {
    expect(getUnansweredToolCallIds([])).toEqual([]);
  });
});
