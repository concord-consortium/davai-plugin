import { ILocalTool } from "./registry";
import { resolveAttribute, resolveDataContext } from "./resolve";

export const createGraphTool: ILocalTool = {
  name: "create_graph",
  description: "Create a graph. x-axis attribute required; y-axis optional (omit for a univariate dot plot).",
  argsExample: '{"tool": "create_graph", "dataContext": "Mammals", "xAttribute": "Height", "yAttribute": "Age", "title": "Height vs Age"}',
  validate(args, ctx) {
    const dc = resolveDataContext(String(args.dataContext ?? ""), ctx.dataContexts());
    if (!dc.ok) return { ok: false, error: dc.error };
    const x = resolveAttribute(String(args.xAttribute ?? ""), dc.value);
    if (!x.ok) return { ok: false, error: x.error };
    const resolved: Record<string, unknown> = {
      dataContextName: dc.value.name, xAttributeName: x.value.attr.name,
    };
    if (args.yAttribute !== undefined && args.yAttribute !== "") {
      const y = resolveAttribute(String(args.yAttribute), dc.value);
      if (!y.ok) return { ok: false, error: y.error };
      resolved.yAttributeName = y.value.attr.name;
    }
    if (typeof args.title === "string" && args.title) resolved.title = args.title;
    return { ok: true, resolved };
  },
  async execute(resolved, ctx) {
    const values: Record<string, unknown> = {
      type: "graph",
      dataContext: resolved.dataContextName,
      ...(resolved.title ? { title: resolved.title } : {}),
      xAttributeName: resolved.xAttributeName,
      ...(resolved.yAttributeName ? { yAttributeName: resolved.yAttributeName } : {}),
    };
    const res = await ctx.sendCODAPRequest({ action: "create", resource: "component", values });
    if (res?.success === false) {
      return `Graph creation failed: ${res?.values?.error ?? "unknown reason"}.`;
    }
    await ctx.refreshGraphs();
    const title = res?.values?.title ?? resolved.title ?? `${resolved.xAttributeName} graph`;
    return `Created graph "${title}" (${resolved.xAttributeName}${resolved.yAttributeName ? ` vs ${resolved.yAttributeName}` : ""}). It is now available for describing or sonifying.`;
  },
};
