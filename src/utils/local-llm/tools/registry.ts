import { listNames } from "./resolve";

export interface ILocalToolContext {
  sendCODAPRequest: (req: unknown) => Promise<any>;
  dataContexts: () => Record<string, any>;
  graphs: () => any[];
  selectedGraphId: () => string | null;
  setSelectedGraphID: (id: number | string) => void;
  refreshDataContexts: () => Promise<void>;
  refreshGraphs: () => Promise<void>;
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

export const registerTools = (tools: ILocalTool[]): void => {
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
    if (!validation.ok) return validation.error;
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
