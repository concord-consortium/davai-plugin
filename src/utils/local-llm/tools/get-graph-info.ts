import { getGraphByID, getGraphAdornments } from "../../codap-api-utils";
import { ILocalTool } from "./registry";
import { resolveGraph } from "./resolve";

export const getGraphInfoTool: ILocalTool = {
  name: "get_graph_info",
  description: "Get a graph's axes, attributes, and visible statistic adornments. Defaults to the selected graph.",
  argsExample: '{"tool": "get_graph_info"} or {"tool": "get_graph_info", "graph": "Height vs Age"}',
  validate(args, ctx) {
    const graph = resolveGraph(args.graph as string | undefined, ctx.graphs(), ctx.selectedGraphId());
    if (!graph.ok) return { ok: false, error: graph.error };
    return { ok: true, resolved: { graphId: graph.value.id } };
  },
  async execute(resolved, _ctx) {
    const graph = await getGraphByID(String(resolved.graphId));
    const adornments = await getGraphAdornments(Number(resolved.graphId));
    const axes = [
      graph?.xAttributeName ? `x-axis: ${graph.xAttributeName}` : "x-axis: (none)",
      graph?.yAttributeName ? `y-axis: ${graph.yAttributeName}` : "y-axis: (none)",
    ].join("; ");
    const adornmentText = adornments.length
      ? adornments.map((a) => `${a.type}: ${a.value ?? `mean ${a.mean}, min ${a.min}, max ${a.max}`}`).join("; ")
      : "none visible";
    return `Graph "${graph?.title ?? graph?.name ?? resolved.graphId}" (data context: ${graph?.dataContext ?? "unknown"}). ${axes}. Adornments: ${adornmentText}.`;
  },
};
