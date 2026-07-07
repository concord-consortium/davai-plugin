import { getCollectionItemsForAttribute } from "../../codap-api-utils";
import { ILocalTool } from "./registry";
import { resolveAttribute, resolveDataContext } from "./resolve";

// Above this many distinct values, a numeric grouping attribute produces a group per (near-)
// unique value rather than a meaningful category split — still allowed (CODAP permits it), but
// the result nudges toward a categorical attribute instead (brief's locked design decision).
const MANY_GROUPS_THRESHOLD = 12;
const MAX_LISTED_GROUPS = 8;

// One group's label + case count, in FIRST-SEEN order (stable, so results are deterministic for
// a given fetch) — sorted by descending count for the result sentence (brief's own worked
// example lists "land (18 cases), water (5), both (4)": largest group first).
const countGroups = (values: unknown[]): { label: string; count: number }[] => {
  const counts = new Map<string, number>();
  for (const v of values) {
    const label = v === null || v === undefined || v === "" ? "(missing)" : String(v);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count);
};

export const groupByTool: ILocalTool = {
  name: "group_by",
  description: "Group a dataset by an attribute, moving it into a new parent collection above the existing " +
    "cases (CODAP's hierarchy feature). Reports the resulting groups and their sizes.",
  argsExample: '{"tool": "group_by", "dataContext": "Mammals", "attribute": "Habitat"}',
  validate(args, ctx) {
    const dc = resolveDataContext(String(args.dataContext ?? ""), ctx.dataContexts());
    if (!dc.ok) return { ok: false, error: dc.error };
    const attr = resolveAttribute(String(args.attribute ?? ""), dc.value);
    if (!attr.ok) return { ok: false, error: attr.error };

    const attributeName = attr.value.attr.name;
    const collections: any[] = dc.value.collections ?? [];

    // Already grouped THIS way: a collection already exists with the exact name we'd create.
    const existingCollection = collections.find((c) => c?.name === attributeName);
    if (existingCollection) {
      return {
        ok: false,
        error: `"${dc.value.name}" is already grouped by "${attributeName}" — a collection named ` +
          `"${attributeName}" already exists. Nothing to change.`,
      };
    }

    // Already grouped by this attribute under a DIFFERENT collection name: the attribute lives
    // in a parent (non-childmost) collection. `collections` is ordered parent-first per CODAP's
    // hierarchy (same ordering findAttributeCollectionInfo/getCollectionItemsForAttributePair
    // rely on elsewhere in this codebase) — so "in a parent collection" means its collection is
    // not the LAST one.
    const collectionIndex = collections.findIndex((c) => c === attr.value.collection);
    if (collectionIndex !== -1 && collectionIndex < collections.length - 1) {
      return {
        ok: false,
        error: `"${dc.value.name}" is already grouped by ${attributeName} (it's in the ` +
          `"${attr.value.collection.name}" parent collection). Nothing to change.`,
      };
    }

    return {
      ok: true,
      resolved: {
        dataContextName: dc.value.name,
        dataContext: dc.value,
        attributeName,
        oldCollectionName: attr.value.collection.name,
      },
    };
  },
  async execute(resolved, ctx) {
    const dataContextName = String(resolved.dataContextName);
    const dataContext = resolved.dataContext as any;
    const attributeName = String(resolved.attributeName);
    const oldCollectionName = String(resolved.oldCollectionName);
    const newCollectionName = attributeName;

    // Fetched BEFORE any mutation: the get-stats fetch pattern (getCollectionItemsForAttribute),
    // reused so the group counts in the result are grounded in real, already-fetched values —
    // never invented — and so the >12-distinct check runs before committing to the CODAP calls.
    const items = await getCollectionItemsForAttribute(dataContext, attributeName);
    const groups = countGroups(items.map((it: any) => it.values[attributeName]));

    const createRes = await ctx.sendCODAPRequest({
      action: "create",
      resource: `dataContext[${dataContextName}].collection`,
      // Confirmed against the vendored @concord-consortium/codap-plugin-api's own
      // createCollectionFromAttribute helper (codap-plugin-api.js): name/title set to the
      // attribute name, and parent: "_root_" is the documented ("Attribute Locations" /
      // Collections doc: 'parent: Name of the parent collection, "_root_" to make this the new
      // root') form for placing the new collection ABOVE the existing hierarchy — exactly what
      // "group by" means (the grouping attribute becomes the new top-level split).
      values: { name: newCollectionName, title: newCollectionName, parent: "_root_" },
    });
    if (createRes?.success === false) {
      // Documented shape is a top-level `error` (sam-server/src/text/codap-api-documentation.ts);
      // fall back to values.error for tolerance against older/nested response shapes.
      const reason = createRes?.error ?? createRes?.values?.error ?? "unknown reason";
      return `Could not group "${dataContextName}" by ${attributeName}: ${reason}. The document is unchanged.`;
    }

    const moveRes = await ctx.sendCODAPRequest({
      action: "update",
      // Scoped to the attribute's CURRENT (old) collection — confirmed form, matching both
      // update-attribute.ts's attributeLocation usage and the vendored library's
      // createCollectionFromAttribute (moveAttributeRequest is scoped to oldCollectionName, with
      // the destination named in values.collection).
      resource: `dataContext[${dataContextName}].collection[${oldCollectionName}].attributeLocation[${attributeName}]`,
      values: { collection: newCollectionName, position: 0 },
    });
    if (moveRes?.success === false) {
      const reason = moveRes?.error ?? moveRes?.values?.error ?? "unknown reason";
      // Never leave a half-state silently (brief requirement): the new collection now exists but
      // is empty (the attribute never made it in) — try to remove it so a retry doesn't collide
      // with "already grouped that way".
      const deleteRes = await ctx.sendCODAPRequest({
        action: "delete",
        resource: `dataContext[${dataContextName}].collection[${newCollectionName}]`,
      });
      if (deleteRes?.success === false) {
        return `Grouping "${dataContextName}" by ${attributeName} failed while moving the attribute: ${reason}. ` +
          `An empty "${newCollectionName}" collection still exists — remove it by dragging it back in CODAP's ` +
          "hierarchy view, or try again.";
      }
      return `Grouping "${dataContextName}" by ${attributeName} failed while moving the attribute: ${reason}. ` +
        `The empty "${newCollectionName}" collection that was created has been removed.`;
    }

    await ctx.refreshDataContexts();

    const shown = groups.slice(0, MAX_LISTED_GROUPS);
    const remaining = groups.length - shown.length;
    const listText = shown.map((g, i) => (i === 0 ? `${g.label} (${g.count} cases)` : `${g.label} (${g.count})`)).join(", ");
    const tail = remaining > 0 ? `, … and ${remaining} more` : "";
    // Brief's exact wording: "this made N groups — grouping by a categorical attribute usually
    // works better" (still succeeds; this is a nudge, not a failure).
    const nudge = groups.length > MANY_GROUPS_THRESHOLD
      ? ` This made ${groups.length} groups — grouping by a categorical attribute usually works better.`
      : "";
    return `Grouped "${dataContextName}" by ${attributeName} — ${groups.length} groups: ${listText}${tail}.${nudge}`;
  },
};
