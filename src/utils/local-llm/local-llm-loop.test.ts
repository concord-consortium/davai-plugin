import { runLocalTurn } from "./local-llm-loop";

const sys = "SYSTEM";
const baseArgs = { systemPrompt: sys, turns: [], userMessage: "describe the graph" };

it("returns the final response directly when the first envelope is final", async () => {
  const generate = jest.fn().mockResolvedValue("{\"tool\":\"final\",\"response\":\"A dot plot.\"}");
  const executeTool = jest.fn();
  const out = await runLocalTurn({ ...baseArgs, generate, executeTool });
  expect(out).toBe("A dot plot.");
  expect(executeTool).not.toHaveBeenCalled();
  // First call gets [system, user] exactly.
  expect(generate.mock.calls[0][0]).toEqual([
    { role: "system", content: sys },
    { role: "user", content: "describe the graph" },
  ]);
});

it("executes a tool call, feeds the result back, then returns the final", async () => {
  const generate = jest.fn()
    .mockResolvedValueOnce("{\"tool\":\"create_request\",\"action\":\"get\",\"resource\":\"dataContext[D].collection[C].allCases\"}")
    .mockResolvedValueOnce("{\"tool\":\"final\",\"response\":\"Values range 1 to 9.\"}");
  const executeTool = jest.fn().mockResolvedValue("{\"success\":true,\"values\":{\"cases\":[1,9]}}");
  const out = await runLocalTurn({ ...baseArgs, generate, executeTool });
  expect(out).toBe("Values range 1 to 9.");
  expect(executeTool).toHaveBeenCalledWith(expect.objectContaining({
    type: "create_request",
    request: expect.objectContaining({ resource: "dataContext[D].collection[C].allCases" }),
  }));
  // Second generation sees the assistant envelope + tool result appended.
  const secondMessages = generate.mock.calls[1][0];
  expect(secondMessages[secondMessages.length - 1].content).toContain("Tool result");
});

it("retries once after an invalid envelope with corrective feedback", async () => {
  const generate = jest.fn()
    .mockResolvedValueOnce("I think the answer is 5")
    .mockResolvedValueOnce("{\"tool\":\"final\",\"response\":\"The answer is 5.\"}");
  const out = await runLocalTurn({ ...baseArgs, generate, executeTool: jest.fn() });
  expect(out).toBe("The answer is 5.");
  const retryMessages = generate.mock.calls[1][0];
  expect(retryMessages[retryMessages.length - 1].content).toMatch(/single JSON object/i);
});

it("degrades to raw text as the final answer after two invalid envelopes", async () => {
  const generate = jest.fn().mockResolvedValue("just plain text, twice");
  const out = await runLocalTurn({ ...baseArgs, generate, executeTool: jest.fn() });
  expect(out).toBe("just plain text, twice");
  expect(generate).toHaveBeenCalledTimes(2);
});

it("forces a final answer at the round cap", async () => {
  // maxRounds 2: rounds 1 and 2 execute; the THIRD tool attempt exceeds the cap, skips
  // execution, and triggers the "answer now" nudge, whose reply is the forced final.
  const toolEnvelope = "{\"tool\":\"create_request\",\"action\":\"get\",\"resource\":\"componentList\"}";
  const generate = jest.fn()
    .mockResolvedValueOnce(toolEnvelope)
    .mockResolvedValueOnce(toolEnvelope)
    .mockResolvedValueOnce(toolEnvelope)
    .mockResolvedValueOnce("{\"tool\":\"final\",\"response\":\"Best effort.\"}");
  const executeTool = jest.fn().mockResolvedValue("{\"success\":true}");
  const out = await runLocalTurn({ ...baseArgs, generate, executeTool, maxRounds: 2 });
  expect(out).toBe("Best effort.");
  expect(executeTool).toHaveBeenCalledTimes(2);
  const finalMessages = generate.mock.calls[3][0];
  expect(finalMessages[finalMessages.length - 1].content).toMatch(/answer now/i);
});

it("returns a fallback message if the forced final is also unusable", async () => {
  const toolEnvelope = "{\"tool\":\"create_request\",\"action\":\"get\",\"resource\":\"componentList\"}";
  const generate = jest.fn()
    .mockResolvedValueOnce(toolEnvelope)
    .mockResolvedValueOnce("");
  const executeTool = jest.fn().mockResolvedValue("{\"success\":true}");
  const out = await runLocalTurn({ ...baseArgs, generate, executeTool, maxRounds: 1 });
  expect(out).toMatch(/wasn't able to complete/i);
});
