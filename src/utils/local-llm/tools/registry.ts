import { listNames } from "./resolve";

export interface ILocalToolContext {
  sendCODAPRequest: (req: unknown) => Promise<any>;
  dataContexts: () => Record<string, any>;
  graphs: () => any[];
  selectedGraphId: () => string | null;
  setSelectedGraphID: (id: number | string) => void;
  refreshDataContexts: () => Promise<void>;
  refreshGraphs: () => Promise<void>;
  // Refills the graph list WITHOUT refreshGraphs's selectNewest side effect (see assistant-model.ts's
  // toolCtx wiring) — for tools that mutate an EXISTING graph (e.g. update_graph) rather than
  // creating one, so the current sonification selection is never disturbed by the refresh itself.
  refreshGraphList: () => Promise<void>;
}

export type ToolValidation =
  | { ok: true; resolved: Record<string, unknown> }
  | { ok: false; error: string };

export interface ILocalTool {
  name: string;
  description: string;
  argsExample: string;
  validate(args: Record<string, unknown>, ctx: ILocalToolContext): ToolValidation;
  execute(resolved: Record<string, unknown>, ctx: ILocalToolContext): Promise<string>;
}

let registered: ILocalTool[] = [];

// PR #114 review item 11 (dev-time guard): a copy-pasted tool file that forgets to rename its
// `name` field would otherwise silently shadow an earlier tool — buildToolDocs would document
// one, dispatchTool would only ever reach the LAST tool registered under that name, and the
// earlier tool becomes permanently unreachable with no error at all. Fail loudly at registration
// time instead, when the mistake is easy to trace to its source.
export const registerTools = (tools: ILocalTool[]): void => {
  const seen = new Set<string>();
  for (const t of tools) {
    if (seen.has(t.name)) throw new Error(`registerTools: duplicate tool name "${t.name}".`);
    seen.add(t.name);
  }
  registered = [...tools];
};

export const getRegisteredTools = (): ILocalTool[] => registered;

// The executor contract the loop depends on: dispatch NEVER rejects. Validation misses,
// unknown tools, and execute exceptions all come back as corrective tool-result strings
// the model can act on in its next round.
export const dispatchTool = async (
  name: string,
  args: Record<string, unknown>,
  ctx: ILocalToolContext
): Promise<string> => {
  const tool = registered.find((t) => t.name === name);
  if (!tool) {
    return `Unknown tool "${name}". Available tools: ${listNames(registered.map((t) => t.name))}.`;
  }
  try {
    const validation = tool.validate(args, ctx);
    // DAVAI-126 matrix round 4 Task F1: live traces showed the model treating a validation-
    // failure string as if it WERE the final answer, or repeating the identical failing call
    // verbatim, instead of retrying with a fix. A uniform instruction appended here — at the one
    // place every validate() failure funnels through — removes that ambiguity for every tool at
    // once, so no per-tool error string has to remember to say it. execute() failures are NOT
    // touched: they already carry their own tool-specific corrective guidance (e.g.
    // create-adornment.ts's compatible-graphs listing).
    if (!validation.ok) {
      return `${validation.error} Call ${name} again now with a corrected argument — do not ` +
        "repeat the same arguments, and do not answer with this message's text.";
    }
    return await tool.execute(validation.resolved, ctx);
  } catch (err) {
    return `Tool "${name}" failed with an internal error: ${err instanceof Error ? err.message : String(err)}. You may retry once or answer with what you have.`;
  }
};

// Generated prompt documentation — the registry is the single source of truth, so adding a
// tool automatically documents it (spec decision 2: docs cannot drift).
export const buildToolDocs = (): string =>
  registered
    .map((t) => `- ${t.name}: ${t.description}\n  ${t.argsExample}`)
    .join("\n");
