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
