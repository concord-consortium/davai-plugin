import { parseEnvelope, stripThink } from "./local-llm-envelope";

it("strips <think> blocks defensively", () => {
  expect(stripThink("<think>reasoning...</think>{\"tool\":\"final\",\"response\":\"hi\"}"))
    .toBe("{\"tool\":\"final\",\"response\":\"hi\"}");
});

// DAVAI-126 matrix round 3 item E7: both think runs' selection-percentile finals were RAW
// <think> dumps truncated mid-sentence at maxTokens — the old stripThink only stripped CLOSED
// <think>...</think> pairs, leaving an unclosed trailing block (maxTokens truncation always cuts
// at the END of the raw generation) completely untouched.
describe("stripThink strips a trailing unclosed <think> block (DAVAI-126 matrix round 3 E7)", () => {
  it("strips a closed pair (existing behavior, unchanged)", () => {
    expect(stripThink("<think>reasoning...</think>{\"tool\":\"final\",\"response\":\"hi\"}"))
      .toBe("{\"tool\":\"final\",\"response\":\"hi\"}");
  });

  it("strips a trailing unclosed <think> block truncated mid-sentence, leaving nothing", () => {
    expect(stripThink("<think>let me think about the 75th percentile but how do I compute")).toBe("");
  });

  it("leaves a preceding valid envelope intact when an unclosed <think> block trails it", () => {
    expect(stripThink('{"tool":"final","response":"ok"}<think>trailing incomplete thought'))
      .toBe('{"tool":"final","response":"ok"}');
  });

  it("strips both a closed pair earlier in the text AND an unclosed trailing block", () => {
    expect(stripThink("<think>first pass</think>some text<think>second thought that never closes"))
      .toBe("some text");
  });
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
