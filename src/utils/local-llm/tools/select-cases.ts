import { getSelectionList } from "../../codap-api-utils";
import { ILocalTool } from "./registry";
import { extractBacktickRefs, resolveAttribute, resolveDataContext } from "./resolve";

export const selectCasesTool: ILocalTool = {
  name: "select_cases",
  description: "Select cases matching a CODAP formula expression (wrap attribute names in backticks; percentile takes 0–1). mode \"replace\" starts a new selection, \"extend\" adds to it.",
  argsExample: '{"tool": "select_cases", "dataContext": "Mammals", "expression": "`Weight` > mean(`Weight`)", "mode": "replace"}',
  validate(args, ctx) {
    const dc = resolveDataContext(String(args.dataContext ?? ""), ctx.dataContexts());
    if (!dc.ok) return { ok: false, error: dc.error };
    const expression = String(args.expression ?? "");
    if (!expression) return { ok: false, error: "Provide an \"expression\" (CODAP formula syntax)." };
    // Resolve each distinct ref once, then canonicalize the expression so repaired names
    // (ladder rung 2, e.g. `weight` -> `Weight`) are what actually gets sent to CODAP —
    // CODAP's formula engine is name-exact and won't apply the same repair itself.
    const canonicalByRef = new Map<string, string>();
    for (const ref of extractBacktickRefs(expression)) {
      if (canonicalByRef.has(ref)) continue;
      const attr = resolveAttribute(ref, dc.value);
      if (!attr.ok) return { ok: false, error: attr.error };
      canonicalByRef.set(ref, attr.value.attr.name);
    }
    const canonicalExpression = expression.replace(/`([^`]+)`/g, (match, ref) => {
      const canonical = canonicalByRef.get(ref);
      return canonical === undefined ? match : `\`${canonical}\``;
    });
    const mode = args.mode === "extend" ? "extend" : "replace";
    return { ok: true, resolved: { dataContextName: dc.value.name, expression: canonicalExpression, mode } };
  },
  async execute(resolved, ctx) {
    const res = await ctx.sendCODAPRequest({
      action: resolved.mode === "extend" ? "update" : "create",
      resource: `dataContext[${resolved.dataContextName}].selectionList`,
      values: { expression: resolved.expression },
    });
    if (res?.success === false) {
      // Documented shape is a top-level `error` (sam-server/src/text/codap-api-documentation.ts);
      // fall back to values.error for tolerance against older/nested response shapes.
      const reason = res?.error ?? res?.values?.error ?? "unknown reason";
      return `Selection failed: ${reason}. Check the expression syntax (attribute names in backticks).`;
    }
    const selection = await getSelectionList(String(resolved.dataContextName));
    return `Selected ${selection.length} cases in "${resolved.dataContextName}" (${resolved.mode} mode).`;
  },
};
