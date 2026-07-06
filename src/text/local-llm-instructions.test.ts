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
