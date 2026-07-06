import { runLocalTurn, MAX_TOOL_RESULT_CHARS } from "./local-llm-loop";
import { trimToBudget } from "./local-llm-prompt";

// A representative system prompt so assertions can compare against the exact assembled/trimmed
// system message the loop builds. The loop trims it against the budget before each generation,
// so we compute the expectation the same way the loop does.
const systemPrompt = "### Role\n\nYou are DAVAI.\n\n### Tools:\n- t: d\n\n/no_think";
const baseArgs = { systemPrompt, turns: [], userMessage: "describe the graph" };

// The exact first-generation message array: trimToBudget([system, user]).
const expectedFirstMessages = (userMessage: string) =>
  trimToBudget([{ role: "system" as const, content: systemPrompt }, { role: "user" as const, content: userMessage }]);

it("returns the final response directly when the first envelope is final", async () => {
  const generate = jest.fn().mockResolvedValue("{\"tool\":\"final\",\"response\":\"A dot plot.\"}");
  const executeTool = jest.fn();
  const out = await runLocalTurn({ ...baseArgs, generate, executeTool });
  expect(out).toBe("A dot plot.");
  expect(executeTool).not.toHaveBeenCalled();
  // First call gets the budgeted [system, user] exactly.
  expect(generate.mock.calls[0][0]).toEqual(expectedFirstMessages("describe the graph"));
});

it("executes a tool call, feeds the result back, then returns the final", async () => {
  const generate = jest.fn()
    .mockResolvedValueOnce("{\"tool\":\"get_case_values\",\"dataContext\":\"D\",\"attribute\":\"A\"}")
    .mockResolvedValueOnce("{\"tool\":\"final\",\"response\":\"Values range 1 to 9.\"}");
  const executeTool = jest.fn(async (name: string, args: Record<string, unknown>) => "{\"success\":true,\"values\":{\"cases\":[1,9]}}");
  const out = await runLocalTurn({ ...baseArgs, generate, executeTool });
  expect(out).toBe("Values range 1 to 9.");
  expect(executeTool).toHaveBeenCalledWith("get_case_values", { dataContext: "D", attribute: "A" });
  // Second generation sees the assistant envelope + tool result appended.
  const secondMessages = generate.mock.calls[1][0];
  expect(secondMessages[secondMessages.length - 1].content).toContain("Tool result");
});

it("invokes the optional onToolCall hook with each tool name, in round order, before executing it (DAVAI-126)", async () => {
  const generate = jest.fn()
    .mockResolvedValueOnce("{\"tool\":\"get_graph_info\"}")
    .mockResolvedValueOnce("{\"tool\":\"get_stats\",\"dataContext\":\"D\",\"attribute\":\"A\"}")
    .mockResolvedValueOnce("{\"tool\":\"final\",\"response\":\"done\"}");
  const calledNamesAtExecuteTime: string[] = [];
  const executeTool = jest.fn(async (name: string) => {
    // Captured from inside executeTool so the assertion also proves onToolCall ran BEFORE
    // executeTool for a given round, not merely "at some point during the turn."
    calledNamesAtExecuteTime.push(...onToolCall.mock.calls.map((c) => c[0]));
    return "{\"success\":true}";
  });
  const onToolCall = jest.fn();
  const out = await runLocalTurn({ ...baseArgs, generate, executeTool, onToolCall });

  expect(out).toBe("done");
  expect(onToolCall.mock.calls.map((c) => c[0])).toEqual(["get_graph_info", "get_stats"]);
  // At the moment the FIRST executeTool ran, onToolCall had already recorded that round's name.
  expect(calledNamesAtExecuteTime[0]).toBe("get_graph_info");
});

it("does not throw when onToolCall is omitted (it is optional)", async () => {
  const generate = jest.fn()
    .mockResolvedValueOnce("{\"tool\":\"get_graph_info\"}")
    .mockResolvedValueOnce("{\"tool\":\"final\",\"response\":\"done\"}");
  const executeTool = jest.fn().mockResolvedValue("{\"success\":true}");
  const out = await runLocalTurn({ ...baseArgs, generate, executeTool }); // no onToolCall
  expect(out).toBe("done");
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
  const toolEnvelope = "{\"tool\":\"get_graph_info\"}";
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
  const toolEnvelope = "{\"tool\":\"get_graph_info\"}";
  const generate = jest.fn()
    .mockResolvedValueOnce(toolEnvelope)
    .mockResolvedValueOnce("");
  const executeTool = jest.fn().mockResolvedValue("{\"success\":true}");
  const out = await runLocalTurn({ ...baseArgs, generate, executeTool, maxRounds: 1 });
  expect(out).toMatch(/wasn't able to complete/i);
});

it("caps an oversized tool result before feeding it back (DAVAI-126 C2)", async () => {
  const generate = jest.fn()
    .mockResolvedValueOnce("{\"tool\":\"get_graph_info\"}")
    .mockResolvedValueOnce("{\"tool\":\"final\",\"response\":\"done\"}");
  // A 30 KB tool result — far over the 8 KB cap.
  const hugeResult = "R".repeat(30_000);
  const executeTool = jest.fn().mockResolvedValue(hugeResult);
  await runLocalTurn({ ...baseArgs, generate, executeTool });

  const secondMessages = generate.mock.calls[1][0];
  const toolMsg = secondMessages[secondMessages.length - 1].content as string;
  expect(toolMsg).toContain("[tool result truncated]");
  // The raw 30 KB blob is not passed through intact.
  expect(toolMsg).not.toContain("R".repeat(MAX_TOOL_RESULT_CHARS + 1));
  // The capped tool-result body is at most the cap plus the short marker line.
  const body = toolMsg.replace("Tool result: ", "");
  expect(body.length).toBeLessThanOrEqual(MAX_TOOL_RESULT_CHARS + "\n[tool result truncated]".length);
});

it("stops between rounds when isCancelled becomes true, returning the fallback (DAVAI-126 C1)", async () => {
  const toolEnvelope = "{\"tool\":\"get_graph_info\"}";
  // Cancel flips true after the first generation (during tool execution). The loop must NOT
  // run a second generation.
  let cancelled = false;
  const generate = jest.fn().mockResolvedValue(toolEnvelope);
  const executeTool = jest.fn().mockImplementation(async () => {
    cancelled = true;
    return "{\"success\":true}";
  });
  const out = await runLocalTurn({
    ...baseArgs, generate, executeTool, isCancelled: () => cancelled,
  });
  expect(out).toMatch(/wasn't able to complete/i);
  // Exactly one generation ran; the cancel check before round 2 stopped the loop.
  expect(generate).toHaveBeenCalledTimes(1);
  expect(executeTool).toHaveBeenCalledTimes(1);
});

it("does not even run the first generation when already cancelled (DAVAI-126 C1)", async () => {
  const generate = jest.fn().mockResolvedValue("{\"tool\":\"final\",\"response\":\"nope\"}");
  const out = await runLocalTurn({
    ...baseArgs, generate, executeTool: jest.fn(), isCancelled: () => true,
  });
  expect(out).toMatch(/wasn't able to complete/i);
  expect(generate).not.toHaveBeenCalled();
});
