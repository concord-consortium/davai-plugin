import { runLocalEval, summarizeEval } from "./eval-runner";
import { evalCases, IEvalCase } from "./eval-cases";

const cases: IEvalCase[] = [
  { id: "zero-tools", prompt: "describe", expectTools: { none: true }, expectFinal: { matches: [/height/i] } },
  { id: "stats", prompt: "mean?", expectTools: { contains: ["get_stats"] }, expectFinal: { matches: [/mean/i] } },
  { id: "order", prompt: "make graph", expectTools: { exactly: ["create_graph"] }, expectFinal: { notMatches: [/error/i] } },
];

it("scores pass/fail per expectation with named failures", async () => {
  const runTurn = jest.fn()
    .mockResolvedValueOnce({ toolCalls: [], final: "The Height values range…" })
    .mockResolvedValueOnce({ toolCalls: ["get_case_values"], final: "The mean is 11." })
    .mockResolvedValueOnce({ toolCalls: ["create_graph"], final: "Created it." });
  const results = await runLocalEval(cases, runTurn);
  expect(results[0].passed).toBe(true);
  expect(results[1].passed).toBe(false);
  expect(results[1].failures[0]).toContain("get_stats");
  expect(results[2].passed).toBe(true);
  expect(summarizeEval(results)).toContain("2/3 passed");
});

it("a runTurn rejection fails that case without aborting the run", async () => {
  const runTurn = jest.fn()
    .mockRejectedValueOnce(new Error("engine died"))
    .mockResolvedValueOnce({ toolCalls: [], final: "hi" });
  const results = await runLocalEval(cases.slice(0, 2), runTurn);
  expect(results[0].passed).toBe(false);
  expect(results[0].failures[0]).toContain("engine died");
  expect(results).toHaveLength(2);
});

it("ships the 14 spec cases with unique ids", () => {
  // DAVAI-126 Task A: added "describe-by-axes" to exercise resolveGraph's rung 3.
  // DAVAI-126 Task C: added "set-attribute-unit" (update_attribute) and "find-heaviest"
  // (find_cases), bringing the total from 12 to 14.
  expect(evalCases).toHaveLength(14);
  expect(new Set(evalCases.map((c) => c.id)).size).toBe(14);
  const miscap = evalCases.find((c) => c.id === "miscapitalized-attribute");
  expect(miscap).toBeDefined();
});

it("describe-by-axes runs after create-graph and before create-adornment, with flipped axis " +
  "word order so title matching alone cannot resolve it (DAVAI-126 Task A)", () => {
  const ids = evalCases.map((e) => e.id);
  const createGraphIdx = ids.indexOf("create-graph");
  const describeByAxesIdx = ids.indexOf("describe-by-axes");
  const createAdornmentIdx = ids.indexOf("create-adornment");
  expect(createGraphIdx).toBeGreaterThanOrEqual(0);
  expect(describeByAxesIdx).toBeGreaterThan(createGraphIdx);
  expect(describeByAxesIdx).toBeLessThan(createAdornmentIdx);
  const c = evalCases.find((e) => e.id === "describe-by-axes")!;
  expect(c.prompt).toBe("Describe the Mass vs Height graph.");
  expect(c.expectTools).toEqual({ contains: ["get_graph_info"] });
  // DAVAI-126 Task B: strengthened with /\d/ — the graph sketch now computed and reported by
  // get_graph_info means a correct answer must ground in an actual number, not just name both axes.
  expect(c.expectFinal).toEqual({ matches: [/mass/i, /height/i, /\d/], notMatches: [/error|sorry/i] });
});

it("set-attribute-unit runs immediately after create-attribute-formula (DAVAI-126 Task C)", () => {
  const ids = evalCases.map((e) => e.id);
  const createAttributeFormulaIdx = ids.indexOf("create-attribute-formula");
  const setAttributeUnitIdx = ids.indexOf("set-attribute-unit");
  expect(createAttributeFormulaIdx).toBeGreaterThanOrEqual(0);
  expect(setAttributeUnitIdx).toBe(createAttributeFormulaIdx + 1);
  const c = evalCases.find((e) => e.id === "set-attribute-unit")!;
  expect(c.prompt).toBe("Set the unit of Height to meters.");
  expect(c.expectTools).toEqual({ contains: ["update_attribute"] });
  expect(c.expectFinal).toEqual({ matches: [/height/i, /meter/i] });
});

it("find-heaviest is the last case in the battery, after miscapitalized-attribute (DAVAI-126 Task C)", () => {
  const ids = evalCases.map((e) => e.id);
  expect(ids[ids.length - 1]).toBe("find-heaviest");
  expect(ids[ids.length - 2]).toBe("miscapitalized-attribute");
  const c = evalCases.find((e) => e.id === "find-heaviest")!;
  expect(c.prompt).toBe("Which mammal is the heaviest?");
  expect(c.expectTools).toEqual({ contains: ["find_cases"] });
  expect(c.expectFinal).toEqual({ matches: [/elephant/i, /6400|6,400/] });
});

describe("eval case corrections (DAVAI-126 eval round 2 item A)", () => {
  it("describe-graph allows only a redundant get_graph_info call (not a strict zero-tools case) " +
    "and strengthens grounding to a specific value", () => {
    const c = evalCases.find((e) => e.id === "describe-graph")!;
    expect(c.expectTools.none).toBeUndefined();
    expect(c.expectTools.allowOnly).toEqual(["get_graph_info"]);
    expect(c.expectFinal.matches).toHaveLength(2);
    expect(c.expectFinal.matches![0]).toEqual(/height/i);
    expect(c.expectFinal.matches![1]).toEqual(/27|0\.1|6\.5/);
    expect(c.expectFinal.notMatches).toEqual([/error|sorry/i]); // unchanged
  });

  it("selection-percentile's prompt now asks for a count (matching its own count assertion)", () => {
    const c = evalCases.find((e) => e.id === "selection-percentile")!;
    expect(c.prompt).toBe("Select the mammals above the 75th percentile of Height, and tell me how many you selected.");
    // Regexes unchanged.
    expect(c.expectTools).toEqual({ contains: ["select_cases"] });
    expect(c.expectFinal.matches).toEqual([/select/i, /\d+\s*(cases?|mammals?)/i]);
  });

  it("create-attribute-formula's prompt uses the correct meters-to-feet multiplier, not the " +
    "cm-to-feet divisor", () => {
    const c = evalCases.find((e) => e.id === "create-attribute-formula")!;
    expect(c.prompt).toBe("Add an attribute called HeightInFeet computed as Height times 3.281.");
    expect(c.expectTools).toEqual({ contains: ["create_attribute"] });
    expect(c.expectFinal.matches).toEqual([/HeightInFeet/i]);
  });

  it("create-adornment's prompt names the Height graph explicitly, avoiding the ambiguous " +
    "\"the graph\" that resolves to whichever graph was created most recently", () => {
    const c = evalCases.find((e) => e.id === "create-adornment")!;
    expect(c.prompt).toBe("Add a mean line to the Height graph.");
    expect(c.expectTools).toEqual({ contains: ["create_adornment"] });
    expect(c.expectFinal.matches).toEqual([/mean/i, /\d/]);
  });
});

describe("per-case timing (DAVAI-126 Task 12)", () => {
  it("records durationMs per case using an injected clock, including a rejecting case", async () => {
    // Sequence of performance.now()-like readings: one pair (start, end) per case, in call order.
    const readings = [0, 1500, 1500, 1500, 1500, 4200]; // case0: 1500ms, case1: 0ms, case2: 2700ms
    let i = 0;
    const now = () => readings[i++];

    const runTurn = jest.fn()
      .mockResolvedValueOnce({ toolCalls: [], final: "The Height values range…" })
      .mockRejectedValueOnce(new Error("engine died"))
      .mockResolvedValueOnce({ toolCalls: ["create_graph"], final: "Created it." });

    const results = await runLocalEval(cases, runTurn, now);

    expect(results[0].durationMs).toBe(1500);
    expect(results[1].durationMs).toBe(0);
    expect(results[1].passed).toBe(false); // the rejection still fails the case
    expect(results[2].durationMs).toBe(2700);
  });

  it("defaults the clock to performance.now() when none is injected", async () => {
    const nowSpy = jest.spyOn(performance, "now");
    nowSpy.mockReturnValueOnce(100).mockReturnValueOnce(350);
    const runTurn = jest.fn().mockResolvedValueOnce({ toolCalls: [], final: "The Height values…" });

    const results = await runLocalEval(cases.slice(0, 1), runTurn);

    expect(results[0].durationMs).toBe(250);
    nowSpy.mockRestore();
  });

  it("summarizeEval appends a one-decimal total duration in seconds", () => {
    const withDurations = [
      { id: "a", passed: true, failures: [], toolCalls: [], toolResults: [], final: "x", durationMs: 42_300 },
      { id: "b", passed: false, failures: ["nope"], toolCalls: [], toolResults: [], final: "y", durationMs: 41_900 },
    ];
    const summary = summarizeEval(withDurations);
    expect(summary).toContain("1/2 passed");
    // Total = 42300 + 41900 = 84200ms = 84.2s, one decimal place.
    expect(summary).toContain("84.2s");
  });
});

describe("allowOnly tool expectation (DAVAI-126 eval round 2 item A)", () => {
  const allowOnlyCase: IEvalCase = {
    id: "allow-only-case",
    prompt: "describe",
    expectTools: { allowOnly: ["get_graph_info"] },
    expectFinal: { matches: [/height/i] },
  };

  it("passes when zero tools are called", async () => {
    const runTurn = jest.fn().mockResolvedValueOnce({ toolCalls: [], final: "The Height values…" });
    const results = await runLocalEval([allowOnlyCase], runTurn);
    expect(results[0].passed).toBe(true);
  });

  it("passes when only listed tools are called (including repeats)", async () => {
    const runTurn = jest.fn().mockResolvedValueOnce({
      toolCalls: ["get_graph_info", "get_graph_info"], final: "The Height values…",
    });
    const results = await runLocalEval([allowOnlyCase], runTurn);
    expect(results[0].passed).toBe(true);
  });

  it("fails when an unlisted tool is called", async () => {
    const runTurn = jest.fn().mockResolvedValueOnce({
      toolCalls: ["get_graph_info", "get_stats"], final: "The Height values…",
    });
    const results = await runLocalEval([allowOnlyCase], runTurn);
    expect(results[0].passed).toBe(false);
    expect(results[0].failures[0]).toContain("get_stats");
  });

  it("fails when only an unlisted tool is called", async () => {
    const runTurn = jest.fn().mockResolvedValueOnce({ toolCalls: ["get_stats"], final: "The Height values…" });
    const results = await runLocalEval([allowOnlyCase], runTurn);
    expect(results[0].passed).toBe(false);
  });
});

describe("toolResults capture (DAVAI-126 eval round 2 item B)", () => {
  it("records tool result strings in call order onto the eval result", async () => {
    const runTurn = jest.fn().mockResolvedValueOnce({
      toolCalls: ["get_stats", "get_case_values"],
      toolResults: ["The mean is 11.", "Values: 10, 12, 14."],
      final: "The mean is 11.",
    });
    const results = await runLocalEval([cases[1]], runTurn);
    expect(results[0].toolResults).toEqual(["The mean is 11.", "Values: 10, 12, 14."]);
  });

  it("truncates each tool result to 300 chars", async () => {
    const long = "x".repeat(400);
    const runTurn = jest.fn().mockResolvedValueOnce({
      toolCalls: ["get_case_values"],
      toolResults: [long],
      final: "done",
    });
    const results = await runLocalEval([cases[1]], runTurn);
    expect(results[0].toolResults[0]).toHaveLength(300);
    expect(results[0].toolResults[0]).toBe(long.slice(0, 300));
  });

  it("defaults to an empty array when the turn result carries no toolResults " +
    "(back-compat with a runTurn stub that only returns toolCalls/final)", async () => {
    const runTurn = jest.fn().mockResolvedValueOnce({ toolCalls: [], final: "hi" });
    const results = await runLocalEval([cases[0]], runTurn);
    expect(results[0].toolResults).toEqual([]);
  });

  it("keeps whatever toolResults were recorded before a rejecting case's error", async () => {
    // The runner itself can't know what a rejected runTurn call had recorded internally before
    // throwing (that state lives inside runTurn, not in the runner) — this pins the runner's own
    // contract: a rejection produces an empty toolResults array on that case's result, exactly
    // like it does for toolCalls, rather than throwing or leaving the field undefined.
    const runTurn = jest.fn().mockRejectedValueOnce(new Error("engine died"));
    const results = await runLocalEval([cases[0]], runTurn);
    expect(results[0].toolResults).toEqual([]);
  });
});

it("selection-percentile's final-answer check uses a single widened count regex " +
  "(DAVAI-126 eval round 1 F3)", () => {
  const selectionCase = evalCases.find((c) => c.id === "selection-percentile");
  expect(selectionCase).toBeDefined();
  const matches = selectionCase!.expectFinal.matches!;
  expect(matches).toHaveLength(2);
  expect(matches[0]).toEqual(/select/i);
  // A SINGLE pattern (not two alternatives joined by `|` at the top level) covering both nouns
  // and tolerating no space before the noun, so replies like "12mammals" or "5 case" still pass.
  const countPattern = matches[1];
  expect(countPattern.source).toBe("\\d+\\s*(cases?|mammals?)");
  const isMatch = (s: string) => countPattern.test(s);
  expect(isMatch("I selected 5 cases above the 75th percentile.")).toBe(true);
  expect(isMatch("Selected 3 mammals.")).toBe(true);
  expect(isMatch("Selected 1 case.")).toBe(true); // singular "case"
  expect(isMatch("Selected 1 mammal.")).toBe(true); // singular "mammal"
  expect(isMatch("Selected 12mammals.")).toBe(true); // no space — the old two-space-locked form missed this
  expect(isMatch("No matching rows found.")).toBe(false);
});
