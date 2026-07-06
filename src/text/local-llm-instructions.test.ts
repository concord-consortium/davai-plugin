import { localLlmInstructions } from "./local-llm-instructions";

it("exports the focused-tools instruction content", () => {
  expect(localLlmInstructions.length).toBeGreaterThan(800);
  expect(localLlmInstructions).toContain('"tool": "final"');
  expect(localLlmInstructions).toContain("exact names");
  // The tool list is generated from the registry — the instructions must not hand-list tools
  // or reference the removed raw-API surface.
  expect(localLlmInstructions).not.toContain("create_request");
  expect(localLlmInstructions).not.toContain("resource");
});

it("steers the model to get_stats for statistics not already shown", () => {
  // Regression: the old wording implied the seed always has statistics, which encourages a
  // small local model to eyeball-average raw values instead of calling get_stats.
  expect(localLlmInstructions).toContain("get_stats");
  expect(localLlmInstructions).toContain(
    "The Selected graph section shows that graph's structure, its values, and any statistics " +
    "listed under Adornments. Answer questions about structure, ranges, and those shown " +
    "statistics directly — but use the get_stats tool for any statistic that is not shown there."
  );
});
