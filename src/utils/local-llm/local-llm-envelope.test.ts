import { parseEnvelope, stripThink } from "./local-llm-envelope";

it("strips <think> blocks defensively", () => {
  expect(stripThink("<think>reasoning...</think>{\"tool\":\"final\",\"response\":\"hi\"}"))
    .toBe("{\"tool\":\"final\",\"response\":\"hi\"}");
});

it("parses a create_request envelope into IToolCallData", () => {
  const raw = JSON.stringify({ tool: "create_request", action: "get", resource: "dataContext[Foo].collection[Bar].allCases" });
  const env = parseEnvelope(raw, 2);
  expect(env).toEqual({
    kind: "tool_call",
    data: {
      type: "create_request",
      tool_call_id: "local-2",
      request: { action: "get", resource: "dataContext[Foo].collection[Bar].allCases", values: undefined },
    },
  });
});

it("parses sonify_graph and final envelopes", () => {
  expect(parseEnvelope("{\"tool\":\"sonify_graph\",\"graphID\":\"42\"}", 0)).toEqual({
    kind: "tool_call",
    data: { type: "sonify_graph", tool_call_id: "local-0", request: { graphID: "42" } },
  });
  expect(parseEnvelope("{\"tool\":\"final\",\"response\":\"All done.\"}", 0)).toEqual({
    kind: "final", response: "All done.",
  });
});

it("flags invalid envelopes with a reason", () => {
  expect(parseEnvelope("not json at all", 0).kind).toBe("invalid");
  expect(parseEnvelope("{\"tool\":\"create_request\"}", 0).kind).toBe("invalid"); // missing action/resource
  expect(parseEnvelope("{\"tool\":\"final\"}", 0).kind).toBe("invalid");          // missing response
  expect(parseEnvelope("{\"tool\":\"unknown\"}", 0).kind).toBe("invalid");
});

it("recovers a JSON object embedded in surrounding text", () => {
  const env = parseEnvelope("Sure! {\"tool\":\"final\",\"response\":\"ok\"} hope that helps", 0);
  expect(env).toEqual({ kind: "final", response: "ok" });
});
