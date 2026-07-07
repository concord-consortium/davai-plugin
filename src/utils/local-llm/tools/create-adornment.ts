import { ILocalTool } from "./registry";
import { graphLabel, resolveGraph } from "./resolve";

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

// DAVAI-126 eval round 2 item F: on a wrong-plot-type rejection, list the retry options the
// model can actually pick from — the "rung-3 corrective-with-options" pattern the models
// demonstrably follow elsewhere (resolve.ts's own corrective errors). Reads the same
// xAttributeName/yAttributeName fields codap-graph-model.ts stores (and get-graph-info.ts
// already reads), not invented ones.
const hasAxis = (g: any): boolean => typeof g?.xAttributeName === "string" || typeof g?.yAttributeName === "string";
const hasBothAxes = (g: any): boolean => typeof g?.xAttributeName === "string" && typeof g?.yAttributeName === "string";
const isUnivariate = (g: any): boolean => hasAxis(g) && !hasBothAxes(g);

// DAVAI-126 matrix round 3 item E1: this file's own local `graphLabel` was `g?.title ?? g?.name`
// with NO empty-string guard and no descriptive fallback — evidence: the live trace
// `Univariate graphs: .` (a single blank entry) when the only candidate had title: "". Now uses
// the shared, RESOLVABLE graphLabel from resolve.ts, which never produces an empty string.
const compatibleGraphsMessage = (type: string, graphs: any[]): string => {
  const wantScatterplot = type === "LSRL";
  const candidates = graphs.filter(wantScatterplot ? hasBothAxes : isUnivariate);
  if (candidates.length === 0) return "No compatible graph exists — create one with create_graph.";
  const titles = candidates.map(graphLabel).join(", ");
  return wantScatterplot ? `Scatterplots: ${titles}.` : `Univariate graphs: ${titles}.`;
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
    // DAVAI-126 matrix round 3 item E1: was `graph.value.title ?? graph.value.name` — evidence:
    // `Added Mean adornment to "undefined"` (an unset field coerced through a template literal).
    // graphLabel is empty-string-safe and prefers a descriptive, resolvable phrase over a raw id.
    return { ok: true, resolved: { graphId: graph.value.id, graphTitle: graphLabel(graph.value), type } };
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
      const options = compatibleGraphsMessage(String(resolved.type), ctx.graphs());
      return `The ${resolved.type} adornment could not be added to "${resolved.graphTitle}": ${reason}. Mean/median/standard deviation need a univariate numeric plot; LSRL needs a scatterplot. ${options}`;
    }
    return `Added ${resolved.type} adornment to "${resolved.graphTitle}": ${formatData(String(resolved.type), res?.values?.data?.[0])}.`;
  },
};
