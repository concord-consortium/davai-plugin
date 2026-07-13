import { getAllCollectionCases } from "../../codap-api-utils";
import { isNumericAxis } from "../graph-sketch";
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

// First attribute of the collection whose ACTUAL case values value-sniff as non-numeric (PR #114
// review item 6 consistency note: schema `attr.type === "categorical"` is unreliable in real
// documents — get-stats.ts's own coercion doc says so and value-sniffs instead — so this tool
// shouldn't trust attr.type alone either; reuses graph-sketch.ts's isNumericAxis, the exact same
// >80%-numeric threshold get_graph_info's own axis-type detection uses). `undefined` when every
// attribute value-sniffs numeric (or the collection has no attrs), in which case the caller falls
// back to a 1-based case index label ("Case 1", "Case 2", ...).
const findLabelAttribute = (collection: any, rows: Record<string, unknown>[]): string | undefined =>
  (collection?.attrs ?? []).find((a: any) =>
    typeof a?.name === "string" && !isNumericAxis(rows.map((r) => r[a.name]))
  )?.name;

// Numeric coercion consistent with get-stats.ts's coerceNumericValues, but returning NaN (not
// filtering it out) — find_cases needs to keep every row for the "of N cases" count while still
// sorting non-numeric values last. Whitespace-only strings are blank data, not zero (PR #114
// review item 11, same fix as get-stats.ts's coerceNumericValues) — Number(" ") is a finite 0,
// which would otherwise sort/display a blank cell as a real numeric zero.
const toNumberOrNaN = (v: unknown): number => {
  if (typeof v === "number") return v;
  const trimmed = typeof v === "string" ? v.trim() : v;
  return trimmed !== "" && trimmed !== null && trimmed !== undefined ? Number(trimmed) : NaN;
};

// Renders one row's parenthetical value: the coerced number when numeric, the RAW STRING when
// non-numeric-but-present (PR #114 review item 6 — e.g. a categorical stat attribute like Diet
// previously printed the numeric-formatted "n/a", which reads as MISSING to a listener about a
// value that IS there), or `undefined` when the value is genuinely blank/missing — the caller
// omits the parenthetical entirely for that case rather than showing a fake "n/a" value. A
// whitespace-only string is blank too (same reasoning as toNumberOrNaN above), so it's trimmed
// before the blank check rather than being displayed as literal whitespace.
const formatValue = (value: unknown): string | undefined => {
  const trimmed = typeof value === "string" ? value.trim() : value;
  if (trimmed === "" || trimmed === null || trimmed === undefined) return undefined;
  const numeric = toNumberOrNaN(value);
  return Number.isFinite(numeric) ? String(numeric) : String(trimmed);
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
    const where = resolved.where as string | undefined;
    const orderBy = resolved.orderBy as string | undefined;

    // Raw per-case value maps from whichever fetch path runs — the label attribute (below) needs
    // these ACTUAL values to value-sniff, so it's resolved after fetching, not before.
    let rawValues: Record<string, unknown>[];

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
      rawValues = matches.map((m) => m?.values ?? {});
    } else {
      const allCases = await getAllCollectionCases(dataContextName, collectionName);
      if (allCases.length === 0) {
        return `No cases found in "${dataContextName}" to order by ${orderBy}.`;
      }
      rawValues = allCases.map((c: any) => c?.case?.values ?? {});
    }

    const labelAttr = findLabelAttribute(collection, rawValues);
    const rows: { label: string; values: Record<string, unknown> }[] = rawValues.map((values, i) => ({
      label: labelAttr ? String(values[labelAttr] ?? `Case ${i + 1}`) : `Case ${i + 1}`,
      values,
    }));
    const totalCount = rows.length;

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
    const shown = top.map((r) => {
      const value = formatValue(r.value);
      return value === undefined ? r.label : `${r.label} (${value})`;
    });
    const whereClause = where ? ` where ${forDisplay(where as string)}` : "";
    return `Top ${top.length} by ${orderBy}${whereClause}: ${shown.join(", ")} (of ${totalCount} cases).`;
  },
};
