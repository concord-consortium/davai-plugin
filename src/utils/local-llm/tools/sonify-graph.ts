import { getGraphByID } from "../../codap-api-utils";
import { isGraphSonifiable } from "../../graph-sonification-utils";
import { ILocalTool } from "./registry";
import { resolveGraph } from "./resolve";

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
    if (!isGraphSonifiable(graph)) {
      return `The graph "${graph?.name ?? resolved.graphId}" is not a numeric scatter plot or univariate dot plot, so it cannot be sonified. Tell the user which plot types work.`;
    }
    ctx.setSelectedGraphID(graph.id);
    return `The graph "${graph?.name ?? graph.id}" is ready to sonify. Tell the user they can use the sonification controls to hear it.`;
  },
};
