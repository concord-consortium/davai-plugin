import { IEvalCase } from "./eval-cases";

export interface IEvalTurnResult { toolCalls: string[]; final: string; }
export interface IEvalResult { id: string; passed: boolean; failures: string[]; toolCalls: string[]; final: string; }

export const runLocalEval = async (
  cases: IEvalCase[],
  runTurn: (prompt: string) => Promise<IEvalTurnResult>
): Promise<IEvalResult[]> => {
  const results: IEvalResult[] = [];
  for (const c of cases) {
    const failures: string[] = [];
    let toolCalls: string[] = [];
    let final = "";
    try {
      const turn = await runTurn(c.prompt);
      toolCalls = turn.toolCalls;
      final = turn.final;
      const { exactly, contains, none } = c.expectTools;
      if (none && toolCalls.length > 0) failures.push(`expected no tool calls, got: ${toolCalls.join(", ")}`);
      if (exactly && JSON.stringify(toolCalls) !== JSON.stringify(exactly)) {
        failures.push(`expected exactly [${exactly.join(", ")}], got [${toolCalls.join(", ")}]`);
      }
      for (const name of contains ?? []) {
        if (!toolCalls.includes(name)) failures.push(`expected a ${name} call, got [${toolCalls.join(", ")}]`);
      }
      for (const re of c.expectFinal.matches ?? []) {
        if (!re.test(final)) failures.push(`final answer did not match ${re}`);
      }
      for (const re of c.expectFinal.notMatches ?? []) {
        if (re.test(final)) failures.push(`final answer should not match ${re}`);
      }
    } catch (err) {
      failures.push(`turn failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    results.push({ id: c.id, passed: failures.length === 0, failures, toolCalls, final });
  }
  return results;
};

export const summarizeEval = (results: IEvalResult[]): string => {
  const passed = results.filter((r) => r.passed).length;
  return `Local eval: ${passed}/${results.length} passed — details in the browser console.`;
};
