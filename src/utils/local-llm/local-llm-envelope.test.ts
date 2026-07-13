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

// DAVAI-126 matrix round 5 Task G1: a live 1.7B final arrived as pretty-printed JSON missing its
// closing brace, and the OLD fallback (extractJson throws when no "}" exists at all → parseEnvelope
// returns kind: "invalid") surfaced the raw envelope text as if it were speakable prose — a screen
// reader would speak "open brace, tool, final, comma...". A malformed "final" attempt must never
// leak raw JSON syntax as the spoken response; recover the response string tolerantly instead.
describe("recovers a malformed \"final\" envelope instead of surfacing raw JSON (DAVAI-126 matrix round 5 Task G1)", () => {
  it("recovers the exact live sample: pretty-printed final envelope missing its closing brace", () => {
    const raw = '{\n  "tool": "final",\n  "response": "The graph displays the \'Height\' attribute of ' +
      "mammals. Values range from about 0.2 to 6 meters, with most mammals clustering between 1 " +
      "and 2 meters. There are a few outliers with notably taller heights, with data points " +
      'extending much higher."';
    expect(parseEnvelope(raw)).toEqual({
      kind: "final",
      response: "The graph displays the 'Height' attribute of mammals. Values range from about 0.2 " +
        "to 6 meters, with most mammals clustering between 1 and 2 meters. There are a few outliers " +
        "with notably taller heights, with data points extending much higher.",
    });
  });

  it("leaves a well-formed final envelope unchanged (no over-eager recovery)", () => {
    expect(parseEnvelope('{"tool":"final","response":"Done."}')).toEqual({ kind: "final", response: "Done." });
  });

  it("leaves a well-formed tool_call envelope unchanged", () => {
    expect(parseEnvelope('{"tool":"get_stats","dataContext":"Mammals","attribute":"Height"}')).toEqual({
      kind: "tool_call", name: "get_stats",
      args: { dataContext: "Mammals", attribute: "Height" },
      raw: '{"tool":"get_stats","dataContext":"Mammals","attribute":"Height"}',
    });
  });

  it("recovers an unterminated response string cut off mid-sentence", () => {
    const raw = '{"tool": "final", "response": "The mean height is about 1.4 meters and most ' +
      "mammals fall between 1 and 2 meters, though a few much taller outliers pull the average";
    expect(parseEnvelope(raw)).toEqual({
      kind: "final",
      response: "The mean height is about 1.4 meters and most mammals fall between 1 and 2 meters, " +
        "though a few much taller outliers pull the average",
    });
  });

  it("recovers a response string containing escaped quotes", () => {
    const raw = '{\n  "tool": "final",\n  "response": "The graph is titled \\"Height vs Age\\" and ' +
      'shows a positive trend."';
    expect(parseEnvelope(raw)).toEqual({
      kind: "final",
      response: 'The graph is titled "Height vs Age" and shows a positive trend.',
    });
  });

  it("decodes \\uXXXX unicode escapes in a recovered response (accented/CJK text stays intact)", () => {
    // A truncated final envelope whose response contains a JSON \u escape — a naive single-char
    // unescape would emit the literal "u00e9"; correct decoding yields "é".
    const raw = '{\n  "tool": "final",\n  "response": "The caf\\u00e9 dataset has 3 r\\u00e9gions"';
    expect(parseEnvelope(raw)).toEqual({
      kind: "final",
      response: "The café dataset has 3 régions",
    });
  });

  // PR #114 review item 11: the fallback's `esc[0] === "u"` check doesn't verify the captured
  // group actually has 4 hex digits — the tolerant regex's SECOND alternative (a bare `.`) can
  // capture just "u" (1 char) when the \u is truncated or followed by non-hex, and the old code
  // still tried to parseInt("", 16) = NaN, then String.fromCharCode(NaN) = a NUL character
  // silently inserted into the "recovered" text.
  describe("a malformed \\u escape falls through to literal text, never a NUL character (PR #114 review item 11)", () => {
    const NUL = String.fromCharCode(0);

    it("generation truncated immediately after \\u (no hex digits at all)", () => {
      const raw = '{\n  "tool": "final",\n  "response": "The caf\\u';
      const result = parseEnvelope(raw);
      if (result.kind !== "final") throw new Error(`expected a recovered final, got: ${result.kind}`);
      expect(result.response).toBe("The cafu");
      expect(result.response).not.toContain(NUL);
    });

    it("\\u followed by invalid (non-hex) characters", () => {
      const raw = '{\n  "tool": "final",\n  "response": "The caf\\uZZZZ later text"';
      const result = parseEnvelope(raw);
      if (result.kind !== "final") throw new Error(`expected a recovered final, got: ${result.kind}`);
      expect(result.response).not.toContain(NUL);
    });
  });

  it("leaves garbage JSON without a \"final\" tool attempt on the existing invalid fallback", () => {
    const result = parseEnvelope("not json at all, no tool field here");
    expect(result.kind).toBe("invalid");
  });

  it("leaves garbage JSON that merely mentions \"final\" as a value (not tool: final) on the " +
    "existing invalid fallback", () => {
    const result = parseEnvelope('{"someField": "final", "other": "stuff"');
    expect(result.kind).toBe("invalid");
  });

  it("does not recover when there is no response field at all to salvage", () => {
    const result = parseEnvelope('{\n  "tool": "final",\n  "notResponse": "oops"');
    expect(result.kind).toBe("invalid");
  });
});
