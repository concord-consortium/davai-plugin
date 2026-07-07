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

// DAVAI-126 matrix round 3 item E7: both think runs' selection-percentile finals were RAW
// <think> dumps truncated mid-sentence at maxTokens, returned AS the final answer — because the
// invalid-envelope branch's own `!text` early-exit bypassed the one-retry mechanism entirely
// whenever the stripped remainder was empty. This is now impossible to distinguish from a genuine
// "nothing to retry with" case only by being empty — the fix routes an empty-after-strip result
// into the SAME one-retry path any other invalid envelope gets, so the model gets one chance to
// produce a real answer before ever falling back.
describe("unclosed <think> dump routes into the retry-once path instead of leaking as a final " +
  "(DAVAI-126 matrix round 3 E7)", () => {
  const unclosedThinkDump = "<think>let me think about the 75th percentile but how do I compute";

  it("an unclosed <think> dump on the FIRST invalid envelope gets the retry, not an immediate " +
    "raw-reasoning final", async () => {
    const generate = jest.fn()
      .mockResolvedValueOnce(unclosedThinkDump)
      .mockResolvedValueOnce("{\"tool\":\"final\",\"response\":\"Selected 5 cases.\"}");
    const out = await runLocalTurn({ ...baseArgs, generate, executeTool: jest.fn() });
    expect(out).toBe("Selected 5 cases.");
    expect(generate).toHaveBeenCalledTimes(2);
    const retryMessages = generate.mock.calls[1][0];
    expect(retryMessages[retryMessages.length - 1].content).toMatch(/single JSON object/i);
    // The raw reasoning dump must never appear anywhere in the retry's corrective prompt content.
    expect(retryMessages[retryMessages.length - 1].content).not.toContain("75th percentile");
  });

  it("if the retry ALSO produces an unclosed <think> dump, the existing fallback response is " +
    "used — never raw reasoning as the final", async () => {
    const generate = jest.fn()
      .mockResolvedValueOnce(unclosedThinkDump)
      .mockResolvedValueOnce("<think>still stuck computing the percentile, running out of tok");
    const out = await runLocalTurn({ ...baseArgs, generate, executeTool: jest.fn() });
    expect(out).toMatch(/wasn't able to complete/i);
    expect(out).not.toContain("percentile");
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it("an unclosed <think> dump followed on retry by ordinary invalid (non-empty) text still " +
    "degrades to that text, unaffected by the empty-string special case", async () => {
    const generate = jest.fn()
      .mockResolvedValueOnce(unclosedThinkDump)
      .mockResolvedValueOnce("just plain text on retry");
    const out = await runLocalTurn({ ...baseArgs, generate, executeTool: jest.fn() });
    expect(out).toBe("just plain text on retry");
  });

  it("a genuinely blank generation (whitespace only, no think tags at all) still gets one retry " +
    "before falling back — the empty-after-strip routing is not think-tag-specific", async () => {
    const generate = jest.fn()
      .mockResolvedValueOnce("   ")
      .mockResolvedValueOnce("{\"tool\":\"final\",\"response\":\"ok\"}");
    const out = await runLocalTurn({ ...baseArgs, generate, executeTool: jest.fn() });
    expect(out).toBe("ok");
    expect(generate).toHaveBeenCalledTimes(2);
  });
});

it("forces a final answer at the round cap", async () => {
  // maxRounds 2: rounds 1 and 2 execute; the THIRD tool attempt exceeds the cap, skips
  // execution, and triggers the "answer now" nudge, whose reply is the forced final.
  // Each call is DISTINCT (different attribute) so this test isolates the round-cap invariant
  // from the repeat-call guard (DAVAI-126 eval round 1 F1), which has its own dedicated tests
  // and would otherwise intercept a run of three identical calls before the cap is ever reached.
  const generate = jest.fn()
    .mockResolvedValueOnce("{\"tool\":\"get_stats\",\"dataContext\":\"D\",\"attribute\":\"Height\"}")
    .mockResolvedValueOnce("{\"tool\":\"get_stats\",\"dataContext\":\"D\",\"attribute\":\"Mass\"}")
    .mockResolvedValueOnce("{\"tool\":\"get_stats\",\"dataContext\":\"D\",\"attribute\":\"Age\"}")
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
  // DAVAI-126 matrix round 3 item E7: an empty generation is now an ordinary invalid envelope
  // that gets the SAME one-retry-then-fallback treatment any other invalid envelope gets (see the
  // dedicated E7 describe block below) — this test's own single "" mock previously relied on the
  // old (buggy) immediate-bail-on-empty-text shortcut. A second "" mock completes the (now
  // correctly longer) retry-once sequence so it still ends at the fallback, per this test's name.
  const generate = jest.fn()
    .mockResolvedValueOnce(toolEnvelope)
    .mockResolvedValueOnce("")
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

it("re-checks isCancelled after generate() resolves a tool envelope and skips executeTool " +
  "if cancel landed during generation (DAVAI-126 review round 2 F3)", async () => {
  // Cancel flips true DURING the await on generate() itself (not between iterations, which C1
  // above already covers) — e.g. the user hits Cancel while the model is still producing a
  // create_graph envelope. The loop must not run the tool just because generate() already
  // started; it must re-check isCancelled once generate() resolves and BEFORE executeTool/
  // onToolCall run.
  let cancelled = false;
  const generate = jest.fn().mockImplementation(async () => {
    cancelled = true; // flips while "awaiting" the (mocked) generation
    return "{\"tool\":\"create_graph\",\"dataContext\":\"D\"}";
  });
  const executeTool = jest.fn().mockResolvedValue("{\"success\":true}");
  const onToolCall = jest.fn();
  const out = await runLocalTurn({
    ...baseArgs, generate, executeTool, onToolCall, isCancelled: () => cancelled,
  });
  expect(out).toMatch(/wasn't able to complete/i);
  expect(executeTool).not.toHaveBeenCalled();
  expect(onToolCall).not.toHaveBeenCalled();
  // The loop must return immediately on the cancel recheck, not loop back for another generation.
  expect(generate).toHaveBeenCalledTimes(1);
});

describe("think-stripped assistant pushes (DAVAI-126 thinking toggle)", () => {
  // Harmless without thinking (raw has no <think> tags to strip); with thinking enabled, this
  // prevents <think>...</think> blocks from bloating the conversation window on every round and
  // follows Qwen's own strip-history convention. Parsing already strips think tags when reading
  // the CURRENT envelope — this is specifically about what gets pushed into history for the NEXT
  // generation to see.
  it("strips <think> tags from the assistant push on a tool-call round", async () => {
    const rawWithThink = "<think>let me check the graph</think>{\"tool\":\"get_graph_info\"}";
    const generate = jest.fn()
      .mockResolvedValueOnce(rawWithThink)
      .mockResolvedValueOnce("{\"tool\":\"final\",\"response\":\"done\"}");
    const executeTool = jest.fn().mockResolvedValue("{\"success\":true}");
    await runLocalTurn({ ...baseArgs, generate, executeTool });

    const secondMessages = generate.mock.calls[1][0];
    const assistantMsg = secondMessages.find((m: { role: string }) => m.role === "assistant");
    expect(assistantMsg.content).not.toContain("<think>");
    expect(assistantMsg.content).not.toContain("let me check the graph");
    expect(assistantMsg.content).toBe("{\"tool\":\"get_graph_info\"}");
  });

  it("strips <think> tags from the assistant push on the invalid-envelope retry", async () => {
    const rawWithThink = "<think>hmm not sure</think>I think the answer is 5";
    const generate = jest.fn()
      .mockResolvedValueOnce(rawWithThink)
      .mockResolvedValueOnce("{\"tool\":\"final\",\"response\":\"The answer is 5.\"}");
    const out = await runLocalTurn({ ...baseArgs, generate, executeTool: jest.fn() });
    expect(out).toBe("The answer is 5.");

    const retryMessages = generate.mock.calls[1][0];
    const assistantMsg = retryMessages.find((m: { role: string }) => m.role === "assistant");
    expect(assistantMsg.content).not.toContain("<think>");
    expect(assistantMsg.content).not.toContain("hmm not sure");
    expect(assistantMsg.content).toBe("I think the answer is 5");
  });

  it("the repeat-guard's synthetic nudge (carrying the executed tool result) is unaffected by " +
    "think-stripping — only model-generated assistant pushes are stripped", async () => {
    const graphEnvelope = "<think>build it</think>{\"tool\":\"create_graph\",\"dataContext\":\"D\",\"xAttr\":\"Height\"}";
    const generate = jest.fn()
      .mockResolvedValueOnce(graphEnvelope)
      .mockResolvedValueOnce(graphEnvelope) // identical repeat — intercepted
      .mockResolvedValueOnce("{\"tool\":\"final\",\"response\":\"Made it.\"}");
    const executeTool = jest.fn().mockResolvedValue("{\"success\":true,\"id\":42}");
    const out = await runLocalTurn({ ...baseArgs, generate, executeTool });

    expect(out).toBe("Made it.");
    const thirdMessages = generate.mock.calls[2][0];
    // The repeated assistant envelope itself is still think-stripped.
    const secondToLast = thirdMessages[thirdMessages.length - 2];
    expect(secondToLast.role).toBe("assistant");
    expect(secondToLast.content).toBe("{\"tool\":\"create_graph\",\"dataContext\":\"D\",\"xAttr\":\"Height\"}");
    // The synthetic nudge (user role) still carries the executed tool's raw JSON result verbatim.
    const last = thirdMessages[thirdMessages.length - 1];
    expect(last.role).toBe("user");
    expect(last.content).toContain("{\"success\":true,\"id\":42}");
  });
});

describe("repeat-call guard (DAVAI-126 eval round 1 F1)", () => {
  // A small local model sometimes repeats an already-successful tool call verbatim instead of
  // answering. The guard tracks the previous EXECUTED call as `${name}::${JSON.stringify(args)}`
  // + its result; an identical next call is intercepted instead of re-executed.
  const graphEnvelope = "{\"tool\":\"create_graph\",\"dataContext\":\"D\",\"xAttr\":\"Height\"}";

  it("(a) does not execute an identical repeat; the synthetic nudge carries the prior result " +
    "and the next generation sees it", async () => {
    const generate = jest.fn()
      .mockResolvedValueOnce(graphEnvelope) // round 1: executes
      .mockResolvedValueOnce(graphEnvelope) // round 2: identical repeat — intercepted
      .mockResolvedValueOnce("{\"tool\":\"final\",\"response\":\"Made it.\"}");
    const executeTool = jest.fn().mockResolvedValue("{\"success\":true,\"id\":42}");
    const out = await runLocalTurn({ ...baseArgs, generate, executeTool });

    expect(out).toBe("Made it.");
    // executeTool ran exactly once total — the repeat was never dispatched.
    expect(executeTool).toHaveBeenCalledTimes(1);

    // The third generation (after the nudge) must see the synthetic user message carrying the
    // prior result, appended after the repeated assistant envelope.
    const thirdMessages = generate.mock.calls[2][0];
    const last = thirdMessages[thirdMessages.length - 1];
    expect(last.role).toBe("user");
    expect(last.content).toContain("You already called create_graph with those arguments.");
    expect(last.content).toContain("Its result was:");
    expect(last.content).toContain("{\"success\":true,\"id\":42}");
    expect(last.content).toContain("do not call it again");
    expect(last.content).toContain("{\"tool\": \"final\"");
    // The repeated assistant envelope itself was still pushed onto the conversation.
    const secondToLast = thirdMessages[thirdMessages.length - 2];
    expect(secondToLast.role).toBe("assistant");
    expect(secondToLast.content).toBe(graphEnvelope);
  });

  it("(b) the model finalizes right after the nudge, returning that final answer", async () => {
    const generate = jest.fn()
      .mockResolvedValueOnce(graphEnvelope)
      .mockResolvedValueOnce(graphEnvelope)
      .mockResolvedValueOnce("{\"tool\":\"final\",\"response\":\"Here is the graph.\"}");
    const executeTool = jest.fn().mockResolvedValue("{\"success\":true}");
    const out = await runLocalTurn({ ...baseArgs, generate, executeTool });
    expect(out).toBe("Here is the graph.");
    expect(generate).toHaveBeenCalledTimes(3);
  });

  it("(c) a THIRD generation that repeats the same call again goes directly to the forced-final " +
    "path without executing", async () => {
    const generate = jest.fn()
      .mockResolvedValueOnce(graphEnvelope) // round 1: executes
      .mockResolvedValueOnce(graphEnvelope) // round 2: 1st repeat — intercepted, nudged
      .mockResolvedValueOnce(graphEnvelope) // round 3: 2nd consecutive identical repeat
      .mockResolvedValueOnce("{\"tool\":\"final\",\"response\":\"Best effort.\"}"); // forced final
    const executeTool = jest.fn().mockResolvedValue("{\"success\":true}");
    const out = await runLocalTurn({ ...baseArgs, generate, executeTool });

    expect(out).toBe("Best effort.");
    expect(executeTool).toHaveBeenCalledTimes(1); // only the original round-1 call ever ran
    expect(generate).toHaveBeenCalledTimes(4);
    // The 4th (forced-final) generation is prompted the same way the round-cap path prompts.
    const forcedMessages = generate.mock.calls[3][0];
    expect(forcedMessages[forcedMessages.length - 1].content).toMatch(/answer now/i);
  });

  it("(d) a call with a different name, or the same name with different args, executes both times " +
    "and resets the repeat tracking", async () => {
    const firstEnvelope = "{\"tool\":\"get_graph_info\"}";
    const secondEnvelope = "{\"tool\":\"get_stats\",\"dataContext\":\"D\",\"attribute\":\"Height\"}";
    const generate = jest.fn()
      .mockResolvedValueOnce(firstEnvelope)
      .mockResolvedValueOnce(secondEnvelope)
      .mockResolvedValueOnce("{\"tool\":\"final\",\"response\":\"done\"}");
    const executeTool = jest.fn().mockResolvedValue("{\"success\":true}");
    const out = await runLocalTurn({ ...baseArgs, generate, executeTool });

    expect(out).toBe("done");
    expect(executeTool).toHaveBeenCalledTimes(2);
    expect(executeTool).toHaveBeenNthCalledWith(1, "get_graph_info", {});
    expect(executeTool).toHaveBeenNthCalledWith(
      2, "get_stats", { dataContext: "D", attribute: "Height" }
    );
  });

  it("(d2) same tool name, different args, back-to-back — both execute (args, not just name, " +
    "distinguish repeats)", async () => {
    const heightEnvelope = "{\"tool\":\"get_stats\",\"dataContext\":\"D\",\"attribute\":\"Height\"}";
    const massEnvelope = "{\"tool\":\"get_stats\",\"dataContext\":\"D\",\"attribute\":\"Mass\"}";
    const generate = jest.fn()
      .mockResolvedValueOnce(heightEnvelope)
      .mockResolvedValueOnce(massEnvelope)
      .mockResolvedValueOnce("{\"tool\":\"final\",\"response\":\"done\"}");
    const executeTool = jest.fn().mockResolvedValue("{\"success\":true}");
    const out = await runLocalTurn({ ...baseArgs, generate, executeTool });

    expect(out).toBe("done");
    expect(executeTool).toHaveBeenCalledTimes(2);
  });

  it("(e) onToolCall fires only for rounds that actually executed — not for the intercepted " +
    "repeat or the forced-final round", async () => {
    const generate = jest.fn()
      .mockResolvedValueOnce(graphEnvelope) // executes — onToolCall fires
      .mockResolvedValueOnce(graphEnvelope) // repeat — intercepted, onToolCall does NOT fire
      .mockResolvedValueOnce("{\"tool\":\"final\",\"response\":\"done\"}");
    const executeTool = jest.fn().mockResolvedValue("{\"success\":true}");
    const onToolCall = jest.fn();
    const out = await runLocalTurn({ ...baseArgs, generate, executeTool, onToolCall });

    expect(out).toBe("done");
    expect(onToolCall).toHaveBeenCalledTimes(1);
    expect(onToolCall).toHaveBeenCalledWith("create_graph");
  });

  it("round counter still advances on an intercepted repeat (cap safety): a repeat that lands " +
    "exactly on the round cap is nudged, not silently forced-final on THIS round", async () => {
    // maxRounds 1: round 1 executes. Round 2 would exceed the cap under normal accounting, but
    // it is ALSO an identical repeat of round 1 — the repeat-guard's own "first repeat" path
    // takes precedence over the round-cap forced-final for this round, per spec: "Round counter
    // still increments (cap safety)" describes bookkeeping, not that the cap pre-empts the nudge.
    const generate = jest.fn()
      .mockResolvedValueOnce(graphEnvelope)
      .mockResolvedValueOnce(graphEnvelope)
      .mockResolvedValueOnce("{\"tool\":\"final\",\"response\":\"done\"}");
    const executeTool = jest.fn().mockResolvedValue("{\"success\":true}");
    const out = await runLocalTurn({ ...baseArgs, generate, executeTool, maxRounds: 1 });

    expect(out).toBe("done");
    expect(executeTool).toHaveBeenCalledTimes(1);
    const thirdMessages = generate.mock.calls[2][0];
    expect(thirdMessages[thirdMessages.length - 1].content).toContain("You already called");
  });

  it("an identical repeat is still subject to the isCancelled recheck before the (skipped) " +
    "execution point — cancelling during the repeated generation returns via the cancel path",
  async () => {
    let cancelled = false;
    const generate = jest.fn()
      .mockResolvedValueOnce(graphEnvelope) // round 1: executes normally
      .mockImplementationOnce(async () => {
        cancelled = true; // flips while "awaiting" the repeat's generation
        return graphEnvelope;
      });
    const executeTool = jest.fn().mockResolvedValue("{\"success\":true}");
    const onToolCall = jest.fn();
    const out = await runLocalTurn({
      ...baseArgs, generate, executeTool, onToolCall, isCancelled: () => cancelled,
    });

    expect(out).toMatch(/wasn't able to complete/i);
    expect(executeTool).toHaveBeenCalledTimes(1); // only round 1's original call
    expect(onToolCall).toHaveBeenCalledTimes(1);
    expect(generate).toHaveBeenCalledTimes(2); // no third generation after the cancel
  });

  it("the invalid-envelope retry flag is unaffected by repeat tracking: an invalid envelope " +
    "after a successful tool call still gets its one retry", async () => {
    const generate = jest.fn()
      .mockResolvedValueOnce(graphEnvelope) // executes
      .mockResolvedValueOnce("not json at all") // invalid — first retry
      .mockResolvedValueOnce("{\"tool\":\"final\",\"response\":\"recovered\"}");
    const executeTool = jest.fn().mockResolvedValue("{\"success\":true}");
    const out = await runLocalTurn({ ...baseArgs, generate, executeTool });
    expect(out).toBe("recovered");
    expect(executeTool).toHaveBeenCalledTimes(1);
  });
});
