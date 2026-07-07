import {
  getGraphByID, getGraphAdornments, getCollectionItemsForAttribute, getCollectionItemsForAttributePair
} from "../../codap-api-utils";
import { computeGraphSketch } from "../graph-sketch";
import { findAttributeUnit } from "../local-llm-prefetch";
import { ILocalTool } from "./registry";
import { graphLabel, resolveGraph } from "./resolve";

// DAVAI-126 Task B: shown only when a sketch was actually produced (non-empty) — steers the
// model toward using the client-computed facts in its answer instead of re-deriving (and
// possibly inventing) cluster/outlier/relationship claims on its own.
const DESCRIBE_CHECKLIST =
  "Describe: axes and units, where most points lie, the outliers above, and what the " +
  "relationship numbers mean in plain words.";

export const getGraphInfoTool: ILocalTool = {
  name: "get_graph_info",
  // DAVAI-126 eval round 2 item D: every matrix run called this tool then answered correctly on
  // describe-intent prompts, even though the same structure/values are already in the prompt's
  // "Selected graph data" section — the steering line below saves that redundant ~3-5s round
  // trip. Editing this string changes the generated tool-list section of the prompt (registry.ts
  // builds it from these descriptions), so the prompt-budget test re-measures with it included.
  description: "Get a graph's axes, attributes, and visible statistic adornments. Defaults to the selected graph. " +
    "The selected graph's structure and values are already in the \"Selected graph data\" section — call this " +
    "only for a different graph or after making a change.",
  argsExample: '{"tool": "get_graph_info"} or {"tool": "get_graph_info", "graph": "Height vs Age"}',
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
      ? adornments.map((a) => `${a.type}: ${a.value ?? `mean ${a.mean}, min ${a.min}, max ${a.max}`}`).join("; ")
      : "none visible";
    // DAVAI-126 matrix round 3 item E1: was `graph?.title ?? graph?.name ?? resolved.graphId` —
    // graphLabel is empty-string-safe and prefers a descriptive, resolvable phrase over a bare id.
    let result = `Graph "${graphLabel(graph)}" (data context: ${graph?.dataContext ?? "unknown"}). ${axes}. Adornments: ${adornmentText}.`;

    // DAVAI-126 Task B: fetch axis values with the SAME fetchers buildGraphSeed uses (pair
    // fetcher for two axes, single-attribute fetcher for one) and reuse computeGraphSketch, so a
    // get_graph_info call surfaces the identical client-computed cluster/outlier/relationship
    // facts a describe request already gets from the seed — never a bare structure dump the
    // model would have to (unreliably) reason over itself.
    if (x || y) {
      const dc = Object.values(ctx.dataContexts() ?? {}).find((d: any) => d?.name === graph?.dataContext);
      if (dc) {
        const items = x && y
          ? await getCollectionItemsForAttributePair(dc, x, y)
          : await getCollectionItemsForAttribute(dc, (x ?? y) as string);
        const sketch = x && y
          ? computeGraphSketch({
              xName: x, yName: y,
              xValues: items.map((it: any) => it.values[x]), yValues: items.map((it: any) => it.values[y]),
              xUnit: findAttributeUnit(dc, x), yUnit: findAttributeUnit(dc, y),
              adornments,
            })
          : computeGraphSketch({
              xName: (x ?? y) as string,
              xValues: items.map((it: any) => it.values[(x ?? y) as string]),
              xUnit: findAttributeUnit(dc, x ?? y),
            });
        if (sketch) result = `${result}\n${sketch}\n${DESCRIBE_CHECKLIST}`;
      }
    }
    return result;
  },
};
