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

it("ships the 11 spec cases with unique ids", () => {
  expect(evalCases).toHaveLength(11);
  expect(new Set(evalCases.map((c) => c.id)).size).toBe(11);
  const miscap = evalCases.find((c) => c.id === "miscapitalized-attribute");
  expect(miscap).toBeDefined();
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
      { id: "a", passed: true, failures: [], toolCalls: [], final: "x", durationMs: 42_300 },
      { id: "b", passed: false, failures: ["nope"], toolCalls: [], final: "y", durationMs: 41_900 },
    ];
    const summary = summarizeEval(withDurations);
    expect(summary).toContain("1/2 passed");
    // Total = 42300 + 41900 = 84200ms = 84.2s, one decimal place.
    expect(summary).toContain("84.2s");
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
