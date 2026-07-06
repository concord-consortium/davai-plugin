import { parseEnvelope, stripThink } from "./local-llm-envelope";

it("strips <think> blocks defensively", () => {
  expect(stripThink("<think>reasoning...</think>{\"tool\":\"final\",\"response\":\"hi\"}"))
    .toBe("{\"tool\":\"final\",\"response\":\"hi\"}");
});

it("parses any tool envelope generically", () => {
  expect(parseEnvelope('{"tool":"get_stats","dataContext":"Mammals","attribute":"Height"}')).toEqual({
    kind: "tool_call", name: "get_stats",
    args: { dataContext: "Mammals", attribute: "Height" },
    raw: '{"tool":"get_stats","dataContext":"Mammals","attribute":"Height"}',
  });
});

it("final and invalid behave as before", () => {
  expect(parseEnvelope('{"tool":"final","response":"Done."}')).toEqual({ kind: "final", response: "Done." });
  expect(parseEnvelope("not json").kind).toBe("invalid");
  expect(parseEnvelope('{"noTool":true}').kind).toBe("invalid");
  expect(parseEnvelope('{"tool":"final"}').kind).toBe("invalid");
});

it("still strips <think> and recovers embedded JSON", () => {
  expect(parseEnvelope('<think>x</think>{"tool":"final","response":"ok"}')).toEqual({ kind: "final", response: "ok" });
  expect(parseEnvelope('Sure! {"tool":"get_graph_info"} thanks')).toEqual({
    kind: "tool_call", name: "get_graph_info", args: {},
    raw: 'Sure! {"tool":"get_graph_info"} thanks'.replace(/<think>[\s\S]*?<\/think>/g, "").trim(),
  });
});
