import { IEvalCase } from "./eval-cases";

// toolResults is optional on the turn contract for back-compat with any runTurn stub written
// before this field existed (e.g. a test double that only returns toolCalls/final) — the runner
// defaults a missing array to [] rather than requiring every caller to supply it.
export interface IEvalTurnResult { toolCalls: string[]; toolResults?: string[]; final: string; }
export interface IEvalResult {
  id: string; passed: boolean; failures: string[]; toolCalls: string[]; toolResults: string[];
  final: string; durationMs: number;
}

// DAVAI-126 eval round 2 item B: cap each recorded tool-result string so the console-logged
// JSON dump (and anyone reading it) isn't overwhelmed by one huge CODAP payload — a truncated
// trace is still useful for confirming what reached the model; a 30KB one is not.
const MAX_TOOL_RESULT_TRACE_CHARS = 300;
const truncateToolResult = (result: string): string => result.slice(0, MAX_TOOL_RESULT_TRACE_CHARS);

// DAVAI-126 Task 12: `now` is injectable (defaults to performance.now()) so tests can drive it
// with a fake sequence instead of depending on wall-clock timing.
export const runLocalEval = async (
  cases: IEvalCase[],
  runTurn: (prompt: string) => Promise<IEvalTurnResult>,
  now: () => number = () => performance.now()
): Promise<IEvalResult[]> => {
  const results: IEvalResult[] = [];
  for (const c of cases) {
    const failures: string[] = [];
    let toolCalls: string[] = [];
    let toolResults: string[] = [];
    let final = "";
    const startedAt = now();
    try {
      const turn = await runTurn(c.prompt);
      toolCalls = turn.toolCalls;
      toolResults = (turn.toolResults ?? []).map(truncateToolResult);
      final = turn.final;
      const { exactly, contains, none, allowOnly } = c.expectTools;
      if (none && toolCalls.length > 0) failures.push(`expected no tool calls, got: ${toolCalls.join(", ")}`);
      if (exactly && JSON.stringify(toolCalls) !== JSON.stringify(exactly)) {
        failures.push(`expected exactly [${exactly.join(", ")}], got [${toolCalls.join(", ")}]`);
      }
      for (const name of contains ?? []) {
        if (!toolCalls.includes(name)) failures.push(`expected a ${name} call, got [${toolCalls.join(", ")}]`);
      }
      if (allowOnly) {
        const unlisted = toolCalls.filter((name) => !allowOnly.includes(name));
        if (unlisted.length > 0) {
          failures.push(`expected only calls from [${allowOnly.join(", ")}], got [${toolCalls.join(", ")}]`);
        }
      }
      for (const re of c.expectFinal.matches ?? []) {
        if (!re.test(final)) failures.push(`final answer did not match ${re}`);
      }
      for (const re of c.expectFinal.notMatches ?? []) {
        if (re.test(final)) failures.push(`final answer should not match ${re}`);
      }
    } catch (err) {
      failures.push(`turn failed: ${err instanceof Error ? err.message : String(err)}`);
      // DAVAI-126 eval round 2 item B: a runTurn that throws mid-turn can still have executed
      // (and recorded results for) tool calls before the error — callers that want those
      // preserved attach them to the thrown error as `toolResults` (see assistant-model.ts's
      // runLocalEvalTurns). Optional and defaulted so a plain Error (or any runTurn stub that
      // doesn't do this) just yields the case's own already-initialized empty array.
      const partial = (err as { toolResults?: string[] } | undefined)?.toolResults;
      if (partial) toolResults = partial.map(truncateToolResult);
    }
    // Duration is recorded around the runTurn await regardless of outcome — a rejecting case
    // still records how long it took to fail.
    const durationMs = now() - startedAt;
    results.push({ id: c.id, passed: failures.length === 0, failures, toolCalls, toolResults, final, durationMs });
  }
  return results;
};

export const summarizeEval = (results: IEvalResult[]): string => {
  const passed = results.filter((r) => r.passed).length;
  const totalSeconds = (results.reduce((sum, r) => sum + r.durationMs, 0) / 1000).toFixed(1);
  return `Local eval: ${passed}/${results.length} passed in ${totalSeconds}s — details in the browser console.`;
};
