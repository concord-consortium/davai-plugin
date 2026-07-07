import { ILocalTool } from "./registry";
import { resolveAttribute, resolveDataContext } from "./resolve";

export const createGraphTool: ILocalTool = {
  name: "create_graph",
  description: "Create a graph. x-axis attribute required; y-axis optional (omit for a univariate dot plot). " +
    "Optional legendAttribute colors points by a categorical attribute.",
  argsExample: '{"tool": "create_graph", "dataContext": "Mammals", "xAttribute": "Height", "yAttribute": "Age", ' +
    '"title": "Height vs Age"} (optional: "legendAttribute")',
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
    if (args.legendAttribute !== undefined && args.legendAttribute !== "") {
      const legend = resolveAttribute(String(args.legendAttribute), dc.value);
      if (!legend.ok) return { ok: false, error: legend.error };
      resolved.legendAttributeName = legend.value.attr.name;
    }
    // DAVAI-126 matrix round 3 item E4: an absent/empty title used to leave the document graph
    // itself UNTITLED (no title sent to CODAP at all) — evidence: `Created graph "" (Height vs
    // Mass)`, which then poisoned a LATER case's resolveGraph corrective (the untitled graph
    // showing up as a blank entry). Default here, at validate time (x/y are already resolved),
    // so the default is always sent to CODAP, not just used for display. Empty-string title
    // counts as absent, same as everywhere else this fix touches.
    const explicitTitle = typeof args.title === "string" && args.title ? args.title : undefined;
    resolved.title = explicitTitle ??
      (resolved.yAttributeName ? `${resolved.xAttributeName} vs ${resolved.yAttributeName}` : String(resolved.xAttributeName));
    return { ok: true, resolved };
  },
  async execute(resolved, ctx) {
    const values: Record<string, unknown> = {
      type: "graph",
      dataContext: resolved.dataContextName,
      title: resolved.title,
      xAttributeName: resolved.xAttributeName,
      ...(resolved.yAttributeName ? { yAttributeName: resolved.yAttributeName } : {}),
      ...(resolved.legendAttributeName ? { legendAttributeName: resolved.legendAttributeName } : {}),
    };
    const res = await ctx.sendCODAPRequest({ action: "create", resource: "component", values });
    if (res?.success === false) {
      // Documented shape is a top-level `error` (sam-server/src/text/codap-api-documentation.ts);
      // fall back to values.error for tolerance against older/nested response shapes.
      const reason = res?.error ?? res?.values?.error ?? "unknown reason";
      return `Graph creation failed: ${reason}.`;
    }
    await ctx.refreshGraphs();
    // DAVAI-126 matrix round 3 item E4: an empty-string echo from CODAP counts as absent (guard
    // against `res?.values?.title` being a real API value of "") — falls back to our own
    // (already-sent) default rather than printing a blank.
    const echoedTitle = typeof res?.values?.title === "string" && res.values.title ? res.values.title : undefined;
    const title = echoedTitle ?? resolved.title;
    return `Created graph "${title}" (${resolved.xAttributeName}${resolved.yAttributeName ? ` vs ${resolved.yAttributeName}` : ""}). It is now available for describing or sonifying.`;
  },
};
