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
    for (const ref of extractBacktickRefs(expression)) {
      const attr = resolveAttribute(ref, dc.value);
      if (!attr.ok) return { ok: false, error: attr.error };
    }
    const mode = args.mode === "extend" ? "extend" : "replace";
    return { ok: true, resolved: { dataContextName: dc.value.name, expression, mode } };
  },
  async execute(resolved, ctx) {
    const res = await ctx.sendCODAPRequest({
      action: resolved.mode === "extend" ? "update" : "create",
      resource: `dataContext[${resolved.dataContextName}].selectionList`,
      values: { expression: resolved.expression },
    });
    if (res?.success === false) {
      const reason = res?.values?.error ?? "unknown reason";
      return `Selection failed: ${reason}. Check the expression syntax (attribute names in backticks).`;
    }
    const selection = await getSelectionList(String(resolved.dataContextName));
    return `Selected ${selection.length} cases in "${resolved.dataContextName}" (${resolved.mode} mode).`;
  },
};
