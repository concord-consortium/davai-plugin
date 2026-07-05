import { localLlmInstructions } from "./local-llm-instructions";
import { localCodapApiDoc } from "./codap-api-documentation";

it("exports non-empty instruction and API doc strings", () => {
  expect(localLlmInstructions.length).toBeGreaterThan(1000);
  expect(localCodapApiDoc.length).toBeGreaterThan(5000);
});

it("specifies the JSON envelope protocol and the fetch-values workflow", () => {
  expect(localLlmInstructions).toContain("\"tool\": \"create_request\"");
  expect(localLlmInstructions).toContain("\"tool\": \"sonify_graph\"");
  expect(localLlmInstructions).toContain("\"tool\": \"final\"");
  expect(localLlmInstructions).toContain("allCases");
  // The image-snapshot workflow must NOT be carried over (text-only model).
  expect(localLlmInstructions).not.toContain("dataDisplay");
  expect(localLlmInstructions).not.toContain("image snapshot");
});
