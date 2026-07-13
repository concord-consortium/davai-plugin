import {
  getGraphByID, getGraphAdornments, getCollectionItemsForAttribute, getCollectionItemsForAttributePair
} from "../../codap-api-utils";
import { computeGraphSketch, getSketchMode } from "../graph-sketch";
import { findAttributeUnit, formatAdornment } from "../local-llm-prefetch";
import { ILocalTool } from "./registry";
import { graphLabel, resolveGraph } from "./resolve";

// Shown only when a sketch was actually produced (non-empty) — steers the model toward using the
// client-computed facts in its answer instead of re-deriving (and possibly inventing)
// cluster/outlier/relationship claims on its own.
// The action-first clause comes FIRST so the model acknowledges a just-created/changed graph
// before falling into the description checklist below — otherwise a post-create/change fetch can
// steer the model into pure description, silently dropping the action confirmation the user most
// wants.
const ACTION_FIRST_CLAUSE = "If you just created or changed a graph, say that first. ";
const DESCRIBE_CHECKLIST =
  `${ACTION_FIRST_CLAUSE}Describe: axes and units, where most points lie, the outliers above, ` +
  "and what the relationship numbers mean in plain words.";
// A numeric-flavored checklist ("the outliers above", "relationship numbers") makes no sense
// appended to a categorical sketch (there is no outlier or Pearson-r concept in category counts).
// This trailer mirrors the numeric one's shape (same action-first lead-in) but asks for the facts
// a categorical sketch actually contains.
const CATEGORICAL_DESCRIBE_CHECKLIST =
  `${ACTION_FIRST_CLAUSE}Describe: the categories and their counts, the largest and smallest ` +
  "groups, and any empty combinations.";

export const getGraphInfoTool: ILocalTool = {
  name: "get_graph_info",
  // Every matrix run called this tool then answered correctly on describe-intent prompts, even
  // though the same structure/values are already in the prompt's "Selected graph data" section —
  // the steering line below saves that redundant ~3-5s round trip. Editing this string changes
  // the generated tool-list section of the prompt (registry.ts builds it from these
  // descriptions), so the prompt-budget test re-measures with it included.
  // The optional "graph" usage is documented here in prose, with no concrete fake name for a
  // small model to imitate; argsExample below shows the no-arg form ONLY, so there is nothing
  // left to copy.
  description: "Get a graph's axes, attributes, and visible statistic adornments. Defaults to the selected graph. " +
    "The selected graph's structure and values are already in the \"Selected graph data\" section — call this " +
    "only for a different graph or after making a change. Pass \"graph\" with a graph's title to inspect a " +
    "different graph.",
  argsExample: '{"tool": "get_graph_info"}',
  validate(args, ctx) {
    const graph = resolveGraph(args.graph as string | undefined, ctx.graphs(), ctx.selectedGraphId());
    if (!graph.ok) return { ok: false, error: graph.error };
    return { ok: true, resolved: { graphId: graph.value.id } };
  },
  async execute(resolved, ctx) {
    const graph = await getGraphByID(String(resolved.graphId));
    const adornments = await getGraphAdornments(Number(resolved.graphId));
    const x = graph?.xAttributeName ?? null;
    const y = graph?.yAttributeName ?? null;
    const axes = [
      x ? `x-axis: ${x}` : "x-axis: (none)",
      y ? `y-axis: ${y}` : "y-axis: (none)",
    ].join("; ");
    const adornmentText = adornments.length
      ? adornments.map(formatAdornment).join("; ")
      : "none visible";
    // graphLabel is empty-string-safe and prefers a descriptive, resolvable phrase over a bare id.
    let result = `Graph "${graphLabel(graph)}" (data context: ${graph?.dataContext ?? "unknown"}). ${axes}. Adornments: ${adornmentText}.`;

    // Fetch axis values with the SAME fetchers buildGraphSeed uses (pair fetcher for two axes,
    // single-attribute fetcher for one) and reuse computeGraphSketch, so a get_graph_info call
    // surfaces the identical client-computed cluster/outlier/relationship facts a describe
    // request already gets from the seed — never a bare structure dump the model would have to
    // (unreliably) reason over itself.
    if (x || y) {
      const dc = Object.values(ctx.dataContexts() ?? {}).find((d: any) => d?.name === graph?.dataContext);
      if (dc) {
        const items = x && y
          ? await getCollectionItemsForAttributePair(dc, x, y)
          : await getCollectionItemsForAttribute(dc, (x ?? y) as string);
        // Built once and reused for both computeGraphSketch and getSketchMode (the mode decides
        // which checklist trailer applies) — a single source of raw values so the two calls can
        // never disagree about what data they're describing.
        const sketchInput = x && y
          ? {
              xName: x, yName: y,
              xValues: items.map((it: any) => it.values[x]), yValues: items.map((it: any) => it.values[y]),
              xUnit: findAttributeUnit(dc, x), yUnit: findAttributeUnit(dc, y),
              adornments,
            }
          : {
              xName: (x ?? y) as string,
              xValues: items.map((it: any) => it.values[(x ?? y) as string]),
              xUnit: findAttributeUnit(dc, x ?? y),
            };
        const sketch = computeGraphSketch(sketchInput);
        if (sketch) {
          const mode = getSketchMode(sketchInput);
          const checklist = mode === "categorical" || mode === "categorical-numeric"
            ? CATEGORICAL_DESCRIBE_CHECKLIST
            : DESCRIBE_CHECKLIST;
          result = `${result}\n${sketch}\n${checklist}`;
        }
      }
    }
    return result;
  },
};
