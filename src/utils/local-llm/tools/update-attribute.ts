import { ILocalTool } from "./registry";
import { extractBacktickRefs, resolveAttribute, resolveDataContext } from "./resolve";

export const updateAttributeTool: ILocalTool = {
  name: "update_attribute",
  description: "Update an existing attribute: rename, set its formula, description, unit, or move it to a new " +
    "position within its collection. At least one of newName/formula/description/unit/position is required.",
  argsExample: '{"tool": "update_attribute", "dataContext": "Mammals", "attribute": "Height", "unit": "meters"} ' +
    '(optional: "newName", "formula", "description", "position")',
  validate(args, ctx) {
    const dc = resolveDataContext(String(args.dataContext ?? ""), ctx.dataContexts());
    if (!dc.ok) return { ok: false, error: dc.error };
    const attr = resolveAttribute(String(args.attribute ?? ""), dc.value);
    if (!attr.ok) return { ok: false, error: attr.error };

    const newName = typeof args.newName === "string" && args.newName.trim() ? args.newName.trim() : undefined;
    const description = typeof args.description === "string" && args.description ? args.description : undefined;
    const unit = typeof args.unit === "string" && args.unit ? args.unit : undefined;
    const formulaRaw = typeof args.formula === "string" && args.formula ? args.formula : undefined;
    const hasPosition = args.position !== undefined && args.position !== null && args.position !== "";
    const positionArg = hasPosition ? Number(args.position) : undefined;
    const position = positionArg !== undefined && Number.isFinite(positionArg) ? Math.floor(positionArg) : undefined;

    // "position" is documented as 0-based; Math.floor(-0.1) silently produces -1 (a value CODAP
    // was never meant to receive) unless explicitly rejected here.
    if (hasPosition && (position === undefined || position < 0)) {
      return { ok: false, error: "\"position\" must be a non-negative integer (0-based)." };
    }

    if (newName === undefined && description === undefined && unit === undefined &&
        formulaRaw === undefined && position === undefined) {
      return {
        ok: false,
        error: "Provide at least one change: \"newName\", \"formula\", \"description\", \"unit\", or \"position\" (0-based).",
      };
    }

    let formula = formulaRaw;
    if (formulaRaw) {
      // Resolve each distinct ref once, then canonicalize the formula so repaired names (ladder
      // rung 2, e.g. `speed` -> `Speed`) are what actually gets sent to CODAP — CODAP's formula
      // engine is name-exact and won't apply the same repair itself (same pattern as
      // select-cases.ts / create-attribute.ts).
      const canonicalByRef = new Map<string, string>();
      for (const ref of extractBacktickRefs(formulaRaw)) {
        if (canonicalByRef.has(ref)) continue;
        const refAttr = resolveAttribute(ref, dc.value);
        if (!refAttr.ok) return { ok: false, error: refAttr.error };
        canonicalByRef.set(ref, refAttr.value.attr.name);
      }
      formula = formulaRaw.replace(/`([^`]+)`/g, (match, ref) => {
        const canonical = canonicalByRef.get(ref);
        return canonical === undefined ? match : `\`${canonical}\``;
      });
    }

    return {
      ok: true,
      resolved: {
        dataContextName: dc.value.name,
        collectionName: attr.value.collection.name,
        attributeName: attr.value.attr.name,
        ...(newName !== undefined ? { newName } : {}),
        ...(formula !== undefined ? { formula } : {}),
        ...(description !== undefined ? { description } : {}),
        ...(unit !== undefined ? { unit } : {}),
        ...(position !== undefined ? { position } : {}),
      },
    };
  },
  async execute(resolved, ctx) {
    const dataContextName = String(resolved.dataContextName);
    const collectionName = String(resolved.collectionName);
    const attributeName = String(resolved.attributeName);
    const newName = resolved.newName as string | undefined;
    const formula = resolved.formula as string | undefined;
    const description = resolved.description as string | undefined;
    const unit = resolved.unit as string | undefined;
    const position = resolved.position as number | undefined;

    const hasAttributeFields = newName !== undefined || formula !== undefined || description !== undefined || unit !== undefined;
    const clauses: string[] = [];
    // The name the result sentence (and any position leg) should refer to going forward — the
    // new name once a rename succeeds, otherwise the name the attribute was already resolved to.
    let currentName = attributeName;

    if (hasAttributeFields) {
      const values: Record<string, unknown> = {
        ...(newName !== undefined ? { name: newName } : {}),
        ...(formula !== undefined ? { formula } : {}),
        ...(description !== undefined ? { description } : {}),
        ...(unit !== undefined ? { unit } : {}),
      };
      const res = await ctx.sendCODAPRequest({
        action: "update",
        resource: `dataContext[${dataContextName}].collection[${collectionName}].attribute[${attributeName}]`,
        values,
      });
      if (res?.success === false) {
        // Documented shape is a top-level `error` (sam-server/src/text/codap-api-documentation.ts);
        // fall back to values.error for tolerance against older/nested response shapes.
        const reason = res?.error ?? res?.values?.error ?? "unknown reason";
        return `Attribute update failed: ${reason}.`;
      }
      await ctx.refreshDataContexts();
      if (newName !== undefined) {
        currentName = newName;
        clauses.push(`renamed to "${newName}"`);
      }
      if (formula !== undefined) clauses.push(`formula set to ${formula}`);
      if (description !== undefined) clauses.push(`description set to "${description}"`);
      if (unit !== undefined) clauses.push(`unit set to "${unit}"`);
    }

    if (position !== undefined) {
      const res = await ctx.sendCODAPRequest({
        action: "update",
        // Confirmed exact form against the vendored @concord-consortium/codap-plugin-api's own
        // updateAttributePosition helper (codap-plugin-api.js): resource scoped to the attribute's
        // collection, values carry `collection` (redundantly, but that's what the library sends)
        // and `position`.
        resource: `dataContext[${dataContextName}].collection[${collectionName}].attributeLocation[${currentName}]`,
        values: { collection: collectionName, position },
      });
      if (res?.success === false) {
        const reason = res?.error ?? res?.values?.error ?? "unknown reason";
        clauses.push(`moving to position ${position} failed: ${reason}`);
      } else {
        clauses.push(`moved to position ${position}`);
      }
    }

    return `Updated attribute "${currentName}" in "${dataContextName}": ${clauses.join("; ")}.`;
  },
};
