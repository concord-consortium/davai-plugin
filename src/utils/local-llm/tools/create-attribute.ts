import { ILocalTool } from "./registry";
import { extractBacktickRefs, resolveAttribute, resolveCollection, resolveDataContext } from "./resolve";

// Array-of-specs is CODAP's canonical attribute-create form. Kept in one builder so an
// API-Tester surprise (bare-object form) changes exactly one function.
export const buildAttributeCreateRequest = (
  dataContextName: string, collectionName: string, name: string, formula?: string
) => ({
  action: "create",
  resource: `dataContext[${dataContextName}].collection[${collectionName}].attribute`,
  values: [{ name, ...(formula ? { formula } : {}) }],
});

export const createAttributeTool: ILocalTool = {
  name: "create_attribute",
  description: "Create a new attribute in a data context, optionally computed by a CODAP formula (attribute names in backticks).",
  argsExample: '{"tool": "create_attribute", "dataContext": "Mammals", "name": "mean_speed", "formula": "mean(`Speed`)"} (optional: "collection")',
  validate(args, ctx) {
    const dc = resolveDataContext(String(args.dataContext ?? ""), ctx.dataContexts());
    if (!dc.ok) return { ok: false, error: dc.error };
    const collection = resolveCollection(args.collection as string | undefined, dc.value);
    if (!collection.ok) return { ok: false, error: collection.error };
    const name = String(args.name ?? "").trim();
    if (!name) return { ok: false, error: "Provide a \"name\" for the new attribute." };
    if (resolveAttribute(name, dc.value).ok) {
      return { ok: false, error: `Attribute "${name}" already exists in "${dc.value.name}". Pick a different name.` };
    }
    const formula = args.formula === undefined ? undefined : String(args.formula);
    let canonicalFormula = formula;
    if (formula) {
      // Resolve each distinct ref once, then canonicalize the formula so repaired names
      // (ladder rung 2, e.g. `speed` -> `Speed`) are what actually gets sent to CODAP —
      // CODAP's formula engine is name-exact and won't apply the same repair itself.
      const canonicalByRef = new Map<string, string>();
      for (const ref of extractBacktickRefs(formula)) {
        if (canonicalByRef.has(ref)) continue;
        const attr = resolveAttribute(ref, dc.value);
        if (!attr.ok) return { ok: false, error: attr.error };
        canonicalByRef.set(ref, attr.value.attr.name);
      }
      canonicalFormula = formula.replace(/`([^`]+)`/g, (match, ref) => {
        const canonical = canonicalByRef.get(ref);
        return canonical === undefined ? match : `\`${canonical}\``;
      });
    }
    return {
      ok: true,
      resolved: { dataContextName: dc.value.name, collectionName: collection.value.name, name, formula: canonicalFormula },
    };
  },
  async execute(resolved, ctx) {
    const res = await ctx.sendCODAPRequest(buildAttributeCreateRequest(
      String(resolved.dataContextName), String(resolved.collectionName),
      String(resolved.name), resolved.formula as string | undefined
    ));
    if (res?.success === false) {
      // Documented shape is a top-level `error` (sam-server/src/text/codap-api-documentation.ts);
      // fall back to values.error for tolerance against older/nested response shapes.
      const reason = res?.error ?? res?.values?.error ?? "unknown reason";
      return `Attribute creation failed: ${reason}.`;
    }
    await ctx.refreshDataContexts();
    // DAVAI-126 eval round 2 item G: echo the (canonicalized) formula verbatim so the eval's
    // toolResults trace (item B) shows exactly what formula reached CODAP — this is what makes
    // a model silently writing a different formula than asked visible in the trace.
    const formulaClause = resolved.formula ? ` computed as ${resolved.formula}` : "";
    return `Created attribute "${resolved.name}" in "${resolved.dataContextName}"${formulaClause}.`;
  },
};
