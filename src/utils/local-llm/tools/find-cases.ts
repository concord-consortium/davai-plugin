import { getAllCollectionCases } from "../../codap-api-utils";
import { ILocalTool } from "./registry";
import { extractBacktickRefs, resolveAttribute, resolveCollectionDefaultLeaf, resolveDataContext } from "./resolve";

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 12;

// Canonicalize backticked refs in a CODAP formula/expression string, the same way
// select-cases.ts and create-attribute.ts do: resolve each distinct ref once, then rewrite every
// span so a repaired name (ladder rung 2, e.g. `sleep` -> `Sleep`) is what actually reaches
// CODAP — CODAP's formula engine is name-exact and won't apply the same repair itself.
const canonicalizeExpression = (
  expression: string, dataContext: any
): { ok: true; value: string } | { ok: false; error: string } => {
  const canonicalByRef = new Map<string, string>();
  for (const ref of extractBacktickRefs(expression)) {
    if (canonicalByRef.has(ref)) continue;
    const attr = resolveAttribute(ref, dataContext);
    if (!attr.ok) return { ok: false, error: attr.error };
    canonicalByRef.set(ref, attr.value.attr.name);
  }
  const value = expression.replace(/`([^`]+)`/g, (match, ref) => {
    const canonical = canonicalByRef.get(ref);
    return canonical === undefined ? match : `\`${canonical}\``;
  });
  return { ok: true, value };
};

// First categorical attribute of the collection (brief's label heuristic) — e.g. "Mammal" in the
// Mammals fixture. `undefined` when the collection has no categorical attribute, in which case
// the caller falls back to a 1-based case index label ("Case 1", "Case 2", ...).
const findLabelAttribute = (collection: any): string | undefined =>
  (collection?.attrs ?? []).find((a: any) => a?.type === "categorical")?.name;

// Numeric coercion consistent with get-stats.ts's coerceNumericValues, but returning NaN (not
// filtering it out) — find_cases needs to keep every row for the "of N cases" count while still
// sorting non-numeric values last.
const toNumberOrNaN = (v: unknown): number =>
  typeof v === "number" ? v : v !== "" && v !== null && v !== undefined ? Number(v) : NaN;

// Renders one row's parenthetical value, e.g. "19.9" or "n/a" for a non-numeric orderBy value
// (brief: "non-numeric values sort last" — they still need a shown value so the count in the
// sentence stays accurate).
const formatValue = (value: unknown): string => {
  const numeric = toNumberOrNaN(value);
  return Number.isFinite(numeric) ? String(numeric) : "n/a";
};

// Strips backticks for the human-facing sentence — CODAP needs `Sleep` (name-exact formula
// syntax), but a screen-reader user hears a condition, not formula punctuation (brief's own
// worked example: "Found 4 cases where Sleep > 12", no backticks). The canonicalized (backticked)
// form is still what's sent to CODAP; only display strips them.
const forDisplay = (expression: string): string => expression.replace(/`/g, "");

// Sort by orderBy, numeric compare, non-numeric last (brief requirement), stable on ties (Array
// sort in V8/Node is stable, and this codebase already relies on that elsewhere — e.g.
// resolve.ts's true-duplicate tiebreak assumes stable insertion order for "most recent" ties).
const sortByOrderBy = (rows: { label: string; value: unknown }[], direction: "asc" | "desc"): { label: string; value: unknown }[] => {
  const withRank = rows.map((r) => ({ ...r, n: toNumberOrNaN(r.value) }));
  const numeric = withRank.filter((r) => Number.isFinite(r.n));
  const nonNumeric = withRank.filter((r) => !Number.isFinite(r.n));
  numeric.sort((a, b) => (direction === "asc" ? a.n - b.n : b.n - a.n));
  return [...numeric, ...nonNumeric];
};

export const findCasesTool: ILocalTool = {
  name: "find_cases",
  // DAVAI-126 matrix round 3 item E6: the canonical phrasing leads with the exact question shape
  // models need to pattern-match to this tool — evidence: 3 of 4 live matrix runs answered
  // "which mammal is the heaviest?" via get_case_values/get_stats instead of find_cases
  // (misaligned/wrong-unit answers); only the run where find_cases was more salient used it, with
  // a perfect one-call answer.
  description: "Find the top/bottom cases by an attribute or cases matching a condition — use for questions " +
    "like \"which mammal is the heaviest?\". \"where\" is a CODAP formula with attribute names in backticks; " +
    "\"orderBy\" ranks by an attribute, highest first by default. Reports matching cases by name.",
  argsExample: '{"tool": "find_cases", "dataContext": "Mammals", "where": "`Sleep` > 12"} or ' +
    '{"tool": "find_cases", "dataContext": "Mammals", "orderBy": "Mass", "limit": 3} (optional: "collection")',
  validate(args, ctx) {
    const dc = resolveDataContext(String(args.dataContext ?? ""), ctx.dataContexts());
    if (!dc.ok) return { ok: false, error: dc.error };
    // Leaf default (DAVAI-126 Task D fix pass): unspecified collection resolves to the childmost
    // collection instead of hard-erroring on multi-collection contexts — a group_by earlier in
    // the session (or battery) permanently adds a parent collection to the shared dataContext,
    // and a lookup must keep working against the case-level leaf afterward. Parent-attribute
    // refs in `where` still work from the leaf: CODAP formula contexts resolve them up the
    // hierarchy. An explicit "collection" arg targets any collection (including a parent), with
    // the standard unknown-name corrective.
    const collectionArg = typeof args.collection === "string" && args.collection ? args.collection : undefined;
    const collection = resolveCollectionDefaultLeaf(collectionArg, dc.value);
    if (!collection.ok) return { ok: false, error: collection.error };

    const whereRaw = typeof args.where === "string" && args.where ? args.where : undefined;
    const orderByRaw = typeof args.orderBy === "string" && args.orderBy ? args.orderBy : undefined;
    if (!whereRaw && !orderByRaw) {
      return {
        ok: false,
        error: 'Provide "where" (a condition, e.g. "`Sleep` > 12") and/or "orderBy" ' +
          '(an attribute to rank by, e.g. {"orderBy": "Mass", "limit": 3}).',
      };
    }

    const resolved: Record<string, unknown> = {
      dataContextName: dc.value.name, collectionName: collection.value.name, dataContext: dc.value, collection: collection.value,
    };

    if (whereRaw) {
      const canonical = canonicalizeExpression(whereRaw, dc.value);
      if (!canonical.ok) return { ok: false, error: canonical.error };
      resolved.where = canonical.value;
    }

    if (orderByRaw) {
      const attr = resolveAttribute(orderByRaw, dc.value);
      if (!attr.ok) return { ok: false, error: attr.error };
      resolved.orderBy = attr.value.attr.name;
      const direction = args.direction === "asc" ? "asc" : "desc";
      resolved.direction = direction;
      const limitArg = Number(args.limit);
      const limit = Number.isFinite(limitArg) && limitArg > 0 ? Math.floor(limitArg) : DEFAULT_LIMIT;
      resolved.limit = Math.min(limit, MAX_LIMIT);
    }

    return { ok: true, resolved };
  },
  async execute(resolved, ctx) {
    const dataContextName = String(resolved.dataContextName);
    const collectionName = String(resolved.collectionName);
    const collection = resolved.collection as any;
    const labelAttr = findLabelAttribute(collection);
    const where = resolved.where as string | undefined;
    const orderBy = resolved.orderBy as string | undefined;

    // Row shape shared by both fetch paths: { label, values } where `values` is the full
    // attribute map for that case (needed for labeling AND for the orderBy stat, whichever
    // fetch path produced it).
    let rows: { label: string; values: Record<string, unknown> }[];
    let totalCount: number;

    if (where) {
      const res = await ctx.sendCODAPRequest({
        action: "get",
        resource: `dataContext[${dataContextName}].collection[${collectionName}].caseFormulaSearch[${where}]`,
      });
      if (res?.success === false) {
        // Documented shape is a top-level `error` (sam-server/src/text/codap-api-documentation.ts);
        // fall back to values.error for tolerance against older/nested response shapes.
        const reason = res?.error ?? res?.values?.error ?? "unknown reason";
        return `Case search failed: ${reason}. Check the expression syntax (attribute names in backticks).`;
      }
      // caseFormulaSearch's confirmed response shape: a FLAT array of {id, parent, collection,
      // values} — NOT allCases's {case: {values}} wrapper (verified against the CODAP API
      // documentation's caseFormulaSearch example; sam-server/src/text/codap-api-documentation.ts
      // does not itself carry this selector — flagged in the task report as a doc gap).
      const matches: any[] = Array.isArray(res?.values) ? res.values : [];
      if (matches.length === 0) {
        const allCases = await getAllCollectionCases(dataContextName, collectionName);
        return `No cases match ${forDisplay(where)} — check the condition (${allCases.length} cases total).`;
      }
      rows = matches.map((m, i) => ({
        label: labelAttr ? String(m?.values?.[labelAttr] ?? `Case ${i + 1}`) : `Case ${i + 1}`,
        values: m?.values ?? {},
      }));
      totalCount = rows.length;
    } else {
      const allCases = await getAllCollectionCases(dataContextName, collectionName);
      if (allCases.length === 0) {
        return `No cases found in "${dataContextName}" to order by ${orderBy}.`;
      }
      rows = allCases.map((c: any, i: number) => ({
        label: labelAttr ? String(c?.case?.values?.[labelAttr] ?? `Case ${i + 1}`) : `Case ${i + 1}`,
        values: c?.case?.values ?? {},
      }));
      totalCount = rows.length;
    }

    if (!orderBy) {
      // where-only: stat by the condition's own attribute (brief's example uses Sleep — the
      // attribute the where expression itself references). Multi-ref expressions stat by the
      // first backticked ref. Brief's worked example names the attribute only on the FIRST row
      // ("Big Brown Bat (Sleep 19.9), Little Brown Bat (19.9), ...") — a natural-language economy
      // once the reader knows which stat is being shown.
      const refs = extractBacktickRefs(where as string);
      const statAttr = refs[0];
      const whereRows = rows.map((r, i) => {
        const value = statAttr ? formatValue(r.values[statAttr]) : undefined;
        if (value === undefined) return r.label;
        return i === 0 ? `${r.label} (${statAttr} ${value})` : `${r.label} (${value})`;
      });
      return `Found ${rows.length} case${rows.length === 1 ? "" : "s"} where ${forDisplay(where as string)}: ${whereRows.join(", ")}.`;
    }

    const limit = Number(resolved.limit);
    const direction = resolved.direction === "asc" ? "asc" : "desc";
    const ranked = sortByOrderBy(rows.map((r) => ({ label: r.label, value: r.values[orderBy] })), direction);
    const top = ranked.slice(0, limit);
    const shown = top.map((r) => `${r.label} (${formatValue(r.value)})`);
    const whereClause = where ? ` where ${forDisplay(where as string)}` : "";
    return `Top ${top.length} by ${orderBy}${whereClause}: ${shown.join(", ")} (of ${totalCount} cases).`;
  },
};
