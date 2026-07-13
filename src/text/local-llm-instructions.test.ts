import { localLlmInstructions } from "./local-llm-instructions";

it("exports the focused-tools instruction content", () => {
  expect(localLlmInstructions.length).toBeGreaterThan(800);
  expect(localLlmInstructions).toContain('"tool": "final"');
  expect(localLlmInstructions).toContain("exact names");
  // The tool list is generated from the registry — the instructions must not hand-list tools
  // or reference the raw-API surface (create_request/resource).
  expect(localLlmInstructions).not.toContain("create_request");
  expect(localLlmInstructions).not.toContain("resource");
});

it("steers the model to get_stats for statistics not already shown", () => {
  // Wording matters here: implying the seed always has statistics would encourage a small local
  // model to eyeball-average raw values instead of calling get_stats.
  expect(localLlmInstructions).toContain("get_stats");
  expect(localLlmInstructions).toContain(
    "The Selected graph section shows that graph's structure, its values, and any statistics " +
    "listed under Adornments. Answer questions about structure, ranges, and those shown " +
    "statistics directly — but use the get_stats tool for any statistic that is not shown there."
  );
});

it("instructs a corrective retry with a picked-from-options argument instead of narrating intent " +
  "(eval round 1 F2)", () => {
  expect(localLlmInstructions).toContain(
    "If a tool result reports an error or lists options, immediately call the tool again with a " +
    "corrected argument picked from those options — never answer with what you are about to do."
  );
});

it("instructs the model never to repeat a tool call that already succeeded (eval round 1 F2)", () => {
  expect(localLlmInstructions).toContain(
    "Never repeat a tool call that already succeeded — use its result."
  );
});

it("instructs the model to ground numbers in its final response in fetched data only (eval round 1 F2)", () => {
  expect(localLlmInstructions).toContain(
    "In your final response, state only numbers that appear in the tool results or in the data " +
    "sections below. If you did not fetch a value, do not state it."
  );
});

it("instructs the model to answer the request, not to summarize whatever the last tool " +
  "returned (DAVAI-126 eval round 2 item C — anti-recency grounding, targets the 1.7B-think " +
  "create-graph failure where the final answer summarized the last tool result instead of " +
  "the request)", () => {
  expect(localLlmInstructions).toContain(
    "Your final response must answer the user's request. After a create, select, or sonify " +
    "tool succeeds, report what it did — do not answer with statistics the user did not ask for."
  );
});

// Invented units are actively harmful misinformation for a blind user who cannot see the data to
// catch the error themselves.
it("instructs the model never to guess units (DAVAI-126 matrix round 5 Task G2 — 4B invented " +
  "\"kilograms\" for Mass, 1.7B invented \"units: cm\" for Height when the true unit was meters)", () => {
  expect(localLlmInstructions).toContain(
    "State units only when the data or a tool result provides them — never guess units."
  );
});
