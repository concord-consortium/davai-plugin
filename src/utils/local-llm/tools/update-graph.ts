import { ILocalTool } from "./registry";
import { resolveAttribute, resolveGraph } from "./resolve";

// The four changeable fields, in the order every enumerated result sentence uses.
type ChangeField = "xAttributeName" | "yAttributeName" | "legendAttributeName" | "title";
const CHANGE_LABELS: Record<ChangeField, string> = {
  xAttributeName: "x-axis",
  yAttributeName: "y-axis",
  legendAttributeName: "legend",
  title: "title",
};

export const updateGraphTool: ILocalTool = {
  name: "update_graph",
  description: "Change an existing graph's x-axis, y-axis, legend, or title. Defaults to the selected graph. " +
    "At least one of xAttribute/yAttribute/legendAttribute/title is required.",
  argsExample: '{"tool": "update_graph", "graph": "Height vs Mass", "yAttribute": "Sleep"} ' +
    '(optional: "xAttribute", "legendAttribute", "title"; "graph" defaults to the selected graph)',
  validate(args, ctx) {
    const graph = resolveGraph(args.graph as string | undefined, ctx.graphs(), ctx.selectedGraphId());
    if (!graph.ok) return { ok: false, error: graph.error };
    const graphTitle = graph.value.title ?? graph.value.name ?? String(graph.value.id);

    const xAttributeRaw = typeof args.xAttribute === "string" && args.xAttribute ? args.xAttribute : undefined;
    const yAttributeRaw = typeof args.yAttribute === "string" && args.yAttribute ? args.yAttribute : undefined;
    const legendAttributeRaw = typeof args.legendAttribute === "string" && args.legendAttribute ? args.legendAttribute : undefined;
    const title = typeof args.title === "string" && args.title ? args.title : undefined;

    // v1 is set-only: the CODAP API documentation (sam-server/src/text/codap-api-documentation.ts)
    // has no documented null/empty removal form for xAttributeName/yAttributeName/
    // legendAttributeName on a graph component — the only "remove" semantics documented anywhere
    // in that file are for Movable Value adornments, unrelated to axis/legend attributes. Rather
    // than invent an undocumented request shape, a "none"/"remove"/"clear" request is rejected
    // with a corrective explaining the limitation, per the brief's explicit fallback instruction.
    const REMOVAL_WORDS = new Set(["none", "remove", "clear", "null"]);
    if (legendAttributeRaw !== undefined && REMOVAL_WORDS.has(legendAttributeRaw.toLowerCase().trim())) {
      return {
        ok: false,
        error: "Removing a graph's legend is not supported yet — only setting a new legendAttribute is. " +
          "Pick a categorical attribute to color by instead.",
      };
    }

    if (xAttributeRaw === undefined && yAttributeRaw === undefined && legendAttributeRaw === undefined && title === undefined) {
      return {
        ok: false,
        error: "Provide at least one change: \"xAttribute\", \"yAttribute\", \"legendAttribute\", or \"title\".",
      };
    }

    // Attributes resolve against the graph's OWN dataContext (brief requirement), not any
    // data context the caller happens to pass — a graph update never takes a dataContext arg.
    const needsAttributeResolution = xAttributeRaw !== undefined || yAttributeRaw !== undefined || legendAttributeRaw !== undefined;
    let dataContext: any;
    if (needsAttributeResolution) {
      dataContext = Object.values(ctx.dataContexts() ?? {}).find((d: any) => d?.name === graph.value.dataContext);
      if (!dataContext) {
        return {
          ok: false,
          error: `Graph "${graphTitle}" has no data context on record, so its attributes can't be resolved. ` +
            "Try again after the graph's data context has loaded.",
        };
      }
    }

    const resolved: Record<string, unknown> = { graphId: graph.value.id, graphTitle };

    if (xAttributeRaw !== undefined) {
      const x = resolveAttribute(xAttributeRaw, dataContext);
      if (!x.ok) return { ok: false, error: x.error };
      resolved.xAttributeName = x.value.attr.name;
    }
    if (yAttributeRaw !== undefined) {
      const y = resolveAttribute(yAttributeRaw, dataContext);
      if (!y.ok) return { ok: false, error: y.error };
      resolved.yAttributeName = y.value.attr.name;
    }
    if (legendAttributeRaw !== undefined) {
      const legend = resolveAttribute(legendAttributeRaw, dataContext);
      if (!legend.ok) return { ok: false, error: legend.error };
      resolved.legendAttributeName = legend.value.attr.name;
    }
    if (title !== undefined) resolved.title = title;

    return { ok: true, resolved };
  },
  async execute(resolved, ctx) {
    const graphId = resolved.graphId;
    const graphTitle = String(resolved.graphTitle);
    const values: Record<string, unknown> = {};
    const clauses: string[] = [];
    // Result sentence names the graph by its NEW title once a rename succeeds (mirrors
    // update_attribute's currentName pattern), otherwise the title it was already resolved to.
    let currentTitle = graphTitle;

    (Object.keys(CHANGE_LABELS) as ChangeField[]).forEach((field) => {
      if (resolved[field] === undefined) return;
      values[field] = resolved[field];
      const value = String(resolved[field]);
      if (field === "title") {
        currentTitle = value;
        clauses.push(`title is now "${value}"`);
      } else {
        clauses.push(`${CHANGE_LABELS[field]} is now ${value}`);
      }
    });

    const res = await ctx.sendCODAPRequest({
      action: "update",
      resource: `component[${graphId}]`,
      values,
    });
    if (res?.success === false) {
      // Documented shape is a top-level `error` (sam-server/src/text/codap-api-documentation.ts);
      // fall back to values.error for tolerance against older/nested response shapes.
      const reason = res?.error ?? res?.values?.error ?? "unknown reason";
      return `Graph update failed: ${reason}.`;
    }
    // Refills the graph list WITHOUT refreshGraphs's selectNewest side effect (see registry.ts's
    // refreshGraphList doc comment) — update_graph mutates an EXISTING graph, so there is no
    // "newest" graph to select, and stealing the current sonification selection here would be a
    // regression, not a refresh.
    await ctx.refreshGraphList();
    return `Updated graph "${currentTitle}": ${clauses.join("; ")}.`;
  },
};
