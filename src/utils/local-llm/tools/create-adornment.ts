import { ILocalTool } from "./registry";
import { resolveGraph } from "./resolve";

// Canonical adornment type strings verified against the CODAP API documentation.
const ADORNMENT_TYPES: { canonical: string; aliases: string[] }[] = [
  { canonical: "Mean", aliases: ["mean"] },
  { canonical: "Median", aliases: ["median"] },
  { canonical: "Standard Deviation", aliases: ["standard deviation", "std dev", "stddev", "standard-deviation"] },
  { canonical: "LSRL", aliases: ["lsrl", "least squares line", "least-squares line", "regression line"] },
];

const normalizeType = (raw: string): string | null => {
  const wanted = raw.toLowerCase().trim().replace(/[\s_-]+/g, " ");
  const hit = ADORNMENT_TYPES.find((t) => t.canonical.toLowerCase() === wanted || t.aliases.includes(wanted));
  return hit ? hit.canonical : null;
};

const formatData = (type: string, d: Record<string, number> | undefined): string => {
  if (!d) return "value not reported";
  if (type === "Mean") return `mean ${d.mean}`;
  if (type === "Median") return `median ${d.median}`;
  if (type === "Standard Deviation") return `mean ${d.mean}, range ${d.min} to ${d.max}`;
  return `slope ${d.slope}, intercept ${d.intercept}, R² ${d.rSquared}`;
};

export const createAdornmentTool: ILocalTool = {
  name: "create_adornment",
  description: "Add a statistic adornment to a graph: mean, median, or standard deviation (univariate numeric plots) or lsrl (scatterplots). Reports the computed value.",
  argsExample: '{"tool": "create_adornment", "type": "mean"} (optional: "graph")',
  validate(args, ctx) {
    const graph = resolveGraph(args.graph as string | undefined, ctx.graphs(), ctx.selectedGraphId());
    if (!graph.ok) return { ok: false, error: graph.error };
    const type = normalizeType(String(args.type ?? ""));
    if (!type) {
      return { ok: false, error: `Unknown adornment type "${args.type}". Available: mean, median, standard deviation, lsrl.` };
    }
    return { ok: true, resolved: { graphId: graph.value.id, graphTitle: graph.value.title ?? graph.value.name, type } };
  },
  async execute(resolved, ctx) {
    const res = await ctx.sendCODAPRequest({
      action: "create",
      resource: `component[${resolved.graphId}].adornment`,
      values: { type: resolved.type },
    });
    if (res?.success === false) {
      // Documented shape is a top-level `error` (sam-server/src/text/codap-api-documentation.ts);
      // fall back to values.error for tolerance against older/nested response shapes.
      const reason = res?.error ?? res?.values?.error ?? "it may not apply to this plot type";
      return `The ${resolved.type} adornment could not be added to "${resolved.graphTitle}": ${reason}. Mean/median/standard deviation need a univariate numeric plot; LSRL needs a scatterplot.`;
    }
    return `Added ${resolved.type} adornment to "${resolved.graphTitle}": ${formatData(String(resolved.type), res?.values?.data?.[0])}.`;
  },
};
