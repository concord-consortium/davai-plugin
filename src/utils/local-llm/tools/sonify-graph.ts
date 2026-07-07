import { getGraphByID } from "../../codap-api-utils";
import { isGraphSonifiable } from "../../graph-sonification-utils";
import { ILocalTool } from "./registry";
import { graphLabel, resolveGraph } from "./resolve";

export const sonifyGraphTool: ILocalTool = {
  name: "sonify_graph",
  description: "Prepare a graph for sonification (audio playback). Works on numeric scatter plots and univariate dot plots. Defaults to the selected graph.",
  argsExample: '{"tool": "sonify_graph"} or {"tool": "sonify_graph", "graph": "Heights"}',
  validate(args, ctx) {
    const graph = resolveGraph(args.graph as string | undefined, ctx.graphs(), ctx.selectedGraphId());
    if (!graph.ok) return { ok: false, error: graph.error };
    return { ok: true, resolved: { graphId: graph.value.id } };
  },
  async execute(resolved, ctx) {
    const graph = await getGraphByID(String(resolved.graphId));
    // DAVAI-126 matrix round 3 item E1: both messages fell back to a raw id (`graph?.name ??
    // resolved.graphId` / `graph?.name ?? graph.id`) — graphLabel is empty-string-safe and
    // prefers a descriptive, resolvable phrase over a bare id.
    if (!isGraphSonifiable(graph)) {
      return `The graph "${graphLabel(graph)}" is not a numeric scatter plot or univariate dot plot, so it cannot be sonified. Tell the user which plot types work.`;
    }
    ctx.setSelectedGraphID(graph.id);
    return `The graph "${graphLabel(graph)}" is ready to sonify. Tell the user they can use the sonification controls to hear it.`;
  },
};
