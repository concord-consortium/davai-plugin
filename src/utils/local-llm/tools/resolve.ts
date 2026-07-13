// The resolution ladder (spec: first-class requirement). For every name argument:
// rung 1 exact match; rung 2 unique normalized match repairs silently (absorbs user/model
// miscapitalization); rung 3 corrective error listing real candidates. Safety rule: repair
// only when unambiguous — never guess among multiple normalized matches.

export interface IResolveHit<T> { ok: true; value: T; repaired: boolean; }
export interface IResolveMiss { ok: false; error: string; }
export type ResolveResult<T> = IResolveHit<T> | IResolveMiss;

export const normalizeName = (s: string): string =>
  s.toLowerCase().trim().replace(/[\s_-]+/g, " ");

export const listNames = (names: string[]): string => {
  const MAX = 12;
  const shown = names.slice(0, MAX).join(", ");
  return names.length > MAX ? `${shown}, …` : shown;
};

export const resolveByName = <T>(
  kind: string,
  requested: string,
  candidates: { name: string; value: T }[]
): ResolveResult<T> => {
  // Gate 2 (PR #114 review #2 root cause): callers type `requested` as `string` via a
  // compile-time-only cast (e.g. `args.graph as string`); when the model's JSON encodes an
  // id-like value unquoted, the runtime value is actually a `number`. Coerce at this shared
  // boundary so every caller is safe even if one forgets to coerce first.
  requested = String(requested);
  const exact = candidates.find((c) => c.name === requested);
  if (exact) return { ok: true, value: exact.value, repaired: false };

  const wanted = normalizeName(requested);
  const normalized = candidates.filter((c) => normalizeName(c.name) === wanted);
  if (normalized.length === 1) return { ok: true, value: normalized[0].value, repaired: true };

  const options = listNames(candidates.map((c) => c.name));
  if (normalized.length > 1) {
    return {
      ok: false,
      error: `"${requested}" matches more than one ${kind} (${listNames(normalized.map((c) => c.name))}). Use the exact name. Available: ${options}.`,
    };
  }
  return { ok: false, error: `Unknown ${kind} "${requested}". Available: ${options}.` };
};

export const resolveDataContext = (
  requested: string | undefined,
  dataContexts: Record<string, any>
): ResolveResult<any> => {
  // Gate 2 boundary coercion (PR #114 review #2 root cause): only when DEFINED, so undefined
  // still means "not provided" rather than becoming the literal string "undefined".
  if (requested !== undefined) requested = String(requested);
  const candidates = Object.values(dataContexts ?? {}).map((dc: any) => ({ name: dc?.name ?? "", value: dc }));
  // Sole-context default (PR #114 review item 8): mirrors resolveCollection's precedent above —
  // an omitted dataContext in a single-dataset document resolves silently instead of bouncing
  // the model with an avoidable "Unknown data context" round trip. Tool call sites pass
  // String(args.dataContext ?? ""), so "" is the common omitted shape alongside undefined. A
  // multi-dataset document still requires an explicit name (today's corrective, unchanged).
  if ((requested === undefined || requested === "") && candidates.length === 1) {
    return { ok: true, value: candidates[0].value, repaired: false };
  }
  return resolveByName("data context", requested ?? "", candidates);
};

export const resolveCollection = (
  requested: string | undefined,
  dataContext: any
): ResolveResult<any> => {
  // Gate 2 boundary coercion (PR #114 review #2 root cause): only when DEFINED, so undefined
  // still means "not provided" rather than becoming the literal string "undefined".
  if (requested !== undefined) requested = String(requested);
  const collections: any[] = dataContext?.collections ?? [];
  if (requested === undefined || requested === "") {
    if (collections.length === 1) return { ok: true, value: collections[0], repaired: false };
    return {
      ok: false,
      error: `"${dataContext?.name}" has more than one collection — specify "collection". Available: ${listNames(collections.map((c) => c.name))}.`,
    };
  }
  return resolveByName("collection", requested, collections.map((c) => ({ name: c.name, value: c })));
};

// DAVAI-126 Task D fix pass: opt-in leaf-collection default, a SEPARATE helper so
// resolveCollection's ask-for-a-name corrective above stays intact for its other caller
// (create_attribute, where "which collection gets the new attribute?" is a genuine question the
// user must answer). For lookup tools (find_cases) the right unspecified-collection default is
// the LEAF (childmost) collection instead: after group_by moves an attribute into a new parent
// collection, the leaf still holds the case-level attributes a lookup targets, and CODAP's
// formula engine resolves parent-attribute refs upward from child formula contexts — plus CODAP's
// own precedent (codap-api-documentation.ts, selection lists: "Omitting `collection` defaults to
// childmost collection"). Ordering evidence that leaf == LAST array element: `collections` is
// stored verbatim from CODAP's get-dataContext response (trimDataset strips attr fields, never
// reorders), getCollectionItemsForAttributePair walks "from the least nested down to the most
// nested collection" by INCREASING index (codap-api-utils.ts:241-248), and
// graph-sonification-model.ts:206 reads collections[0] as "the parent collection".
export const resolveCollectionDefaultLeaf = (
  requested: string | undefined,
  dataContext: any
): ResolveResult<any> => {
  if (requested === undefined || requested === "") {
    const collections: any[] = dataContext?.collections ?? [];
    if (collections.length === 0) {
      return { ok: false, error: `"${dataContext?.name}" has no collections.` };
    }
    return { ok: true, value: collections[collections.length - 1], repaired: false };
  }
  return resolveCollection(requested, dataContext);
};

export const resolveAttribute = (
  requested: string,
  dataContext: any
): ResolveResult<{ attr: any; collection: any }> => {
  // Gate 2 boundary coercion (PR #114 review #2 root cause).
  requested = String(requested);
  const candidates: { name: string; value: { attr: any; collection: any } }[] = [];
  for (const collection of dataContext?.collections ?? []) {
    for (const attr of collection?.attrs ?? []) {
      candidates.push({ name: attr.name, value: { attr, collection } });
    }
  }
  return resolveByName("attribute", requested, candidates);
};

// DAVAI-126 Task A: graph resolution needs more than title/name matching (rungs 1-2, still
// handled by resolveByName above) — users describe graphs by axes and shape ("the height dot
// plot"), and CODAP's UI happily creates multiple graphs with the same title, which rungs 1-2
// alone cannot disambiguate. Rung 3 (axis + plot-type matching) and rung 4 (descriptive
// corrective) below are additive: they only engage when rungs 1-2 produce no unique hit.

// Shape source: `plotType` is live, branched-on, verified production data elsewhere in this repo
// (graph-sonification-utils.ts's isUnivariateDotPlot/isUnsplitScatterPlot, graph-sonification-
// model.ts) — real runtime values confirmed there and in graph-sonification-model.test.ts include
// "dotPlot", "binnedDotPlot", "scatterPlot", and "barChart". A CODAP barChart commonly has only an
// x-attribute set, which axis-presence alone would misread as a dot plot — so plotType, when
// present, is authoritative over axis-presence for both the shape word AND the rung-3 filter
// bucket. `plotType` is `types.maybe(types.string)` on the model (codap-graph-model.ts) and is
// legitimately absent sometimes; axis-presence is used ONLY as the fallback for that case, exactly
// as before this fix, matching how create-adornment.ts's own hasAxis/hasBothAxes read shape when
// no more authoritative signal exists.
const hasX = (g: any): boolean => typeof g?.xAttributeName === "string" && g.xAttributeName.length > 0;
const hasY = (g: any): boolean => typeof g?.yAttributeName === "string" && g.yAttributeName.length > 0;

// Bucket used by the rung-3 plot-type filter: "bivariate" (scatterplot filter keeps these),
// "univariate" (dot-plot filter keeps these), or "other" (a shape neither filter should claim —
// e.g. a bar chart with one axis must NOT be swept into the dot-plot bucket just because it has
// exactly one axis populated).
type GraphBucket = "bivariate" | "univariate" | "other";
const graphBucket = (g: any): GraphBucket => {
  const plotType = g?.plotType;
  if (plotType === "scatterPlot") return "bivariate";
  // Exactly the dot-plot value set graph-sonification-utils.ts's isUnivariateDotPlot recognizes
  // (plotType === "dotPlot" || plotType === "binnedDotPlot") — a binned dot plot is still a dot
  // plot to the user, so it must be matched by the "dot plot" rung-3 filter and labeled as one.
  if (plotType === "dotPlot" || plotType === "binnedDotPlot") return "univariate";
  if (typeof plotType === "string") return "other"; // e.g. "barChart"
  // plotType undefined: legitimate absence (types.maybe) — fall back to the pre-existing
  // axis-presence heuristic, unchanged from before this fix.
  if (hasX(g) && hasY(g)) return "bivariate";
  if (hasX(g) || hasY(g)) return "univariate";
  return "other";
};

// Bare title/name label — empty string ("" is a real value CODAP sends for an untitled graph, see
// module doc below) is normalized away to undefined so every caller treats "no title" and "" the
// same way, rather than one caller's `??` chain accidentally accepting an empty string as if it
// were meaningful text (evidence: `Graphs: "" (dot plot of Height)` in the live traces). Used only
// where a SHORT bare label is wanted inside a larger construction (quoted in describeGraphOption,
// hashed for the true-duplicate tiebreak's identity key) — NOT the public, always-non-empty,
// always-resolvable `graphLabel` below, which these two are intentionally kept distinct from.
const nonEmpty = (s: unknown): string | undefined => (typeof s === "string" && s.length > 0 ? s : undefined);
const rawGraphLabel = (g: any): string => nonEmpty(g?.title) ?? nonEmpty(g?.name) ?? "";

// e.g. "Height" (dot plot of Height) / "Height vs Mass" (scatterplot of Height vs Mass) /
// "Species" (bar chart of Species) / "Untitled" (graph). Shape word comes from `graphBucket`
// (plotType-first, axis-presence fallback); the "of <axis>" clause still reads the actual axis
// attribute names so the descriptive text stays accurate regardless of which signal chose the
// shape word.
const shapeWordFor = (g: any, bucket: GraphBucket): string => {
  const plotType = g?.plotType;
  if (plotType === "barChart") return "bar chart";
  if (bucket === "bivariate") return "scatterplot";
  if (bucket === "univariate") return "dot plot";
  return "graph";
};

// DAVAI-126 matrix round 3 item E1: uses the shared, public graphLabel (defined further below in
// this file — a function BODY reference, evaluated only when describeGraphOption is actually
// called, by which point module init has long finished, so this is not a temporal-dead-zone
// issue) rather than the bare rawGraphLabel — evidence: the live trace `Graphs: "" (dot plot of
// Height)`, i.e. THIS function quoting an empty string for an untitled/unnamed graph. graphLabel's
// descriptive fallback tier means the quoted label itself is never blank, even though the
// parenthetical shape clause already restates similar information (a little redundant for an
// already-titled graph, e.g. `"Height" (dot plot of Height)`, but that redundancy already existed
// before this fix for any titled graph and is not new).
export const describeGraphOption = (g: any): string => {
  const label = graphLabel(g);
  const bucket = graphBucket(g);
  const x = hasX(g) ? g.xAttributeName : undefined;
  const y = hasY(g) ? g.yAttributeName : undefined;
  const word = shapeWordFor(g, bucket);
  let shape: string;
  if (x && y) shape = `${word} of ${x} vs ${y}`;
  else if (x || y) shape = `${word} of ${x ?? y}`;
  else shape = word;
  return `"${label}" (${shape})`;
};

const MAX_LISTED_OPTIONS = 6;
const listGraphOptions = (graphs: any[]): string => {
  const shown = graphs.slice(0, MAX_LISTED_OPTIONS).map(describeGraphOption).join("; ");
  return graphs.length > MAX_LISTED_OPTIONS ? `${shown}; …` : shown;
};

// A short phrase that itself resolves back to `g` via rung 3 — used as the "e.g." example in
// rung-4 messages. CLOSURE PROPERTY: whatever we tell the user to say must actually work, so this
// must use a phrasing that rung 3's OWN filter (see resolveByAxes below, which keys off the same
// graphBucket) will route back to this graph's bucket, combined with axis text rung 3 scores by
// substring containment. A bar chart's word ("bar chart") deliberately does NOT contain "scatter"
// or "dot plot", so it triggers neither filter — it round-trips via axis-name scoring alone, which
// is correct: rung 3 has no bar-chart-specific filter bucket to route it through.
const exampleGraphPhrase = (g: any): string => {
  const bucket = graphBucket(g);
  const x = hasX(g) ? g.xAttributeName : undefined;
  const y = hasY(g) ? g.yAttributeName : undefined;
  if (bucket === "bivariate" && x && y) return `the ${x} vs ${y} scatterplot`;
  const shapeWord = shapeWordFor(g, bucket);
  const axisWord = x ?? y ?? rawGraphLabel(g);
  return `the ${axisWord} ${shapeWord}`;
};

// DAVAI-126 matrix round 3 item E1: the SHARED, PUBLIC graph label — every surface that prints a
// graph reference (buildGraphSeed's header, describeGraphOption's corrective, create_adornment's
// compatible-graphs lists, and every mutating tool's result string) must use this, so a model
// echoing the label back always resolves via resolveGraph (rung 3 for a descriptive fallback,
// rung 1 for a title/name). Fallback chain, each tier gated on non-emptiness (an empty string is
// treated as ABSENT everywhere, never as a real "blank" label — the bug this fixes):
//   1. non-empty title
//   2. non-empty name
//   3. a descriptive phrase reusing exampleGraphPhrase's rung-3-round-tripping shape logic — but
//      ONLY when there is at least one axis to describe (exampleGraphPhrase's own last-ditch
//      fallback is rawGraphLabel, which would otherwise contribute an already-ruled-out empty
//      string here and produce a broken "the  graph" phrase)
//   4. a bare id reference ("graph 885090985993956") for a graph with no title, no name, and no
//      axes at all — still ACCEPTED back via rung 0 (E2), even though it is never the preferred
//      display form.
export const graphLabel = (g: any): string => {
  const title = nonEmpty(g?.title);
  if (title) return title;
  const name = nonEmpty(g?.name);
  if (name) return name;
  if (hasX(g) || hasY(g)) return exampleGraphPhrase(g);
  return `graph ${g?.id}`;
};

// Rung 4: replaces both prior failure messages (no-match "Unknown graph" and ambiguous "matches
// more than one") with a listing that actually helps the user pick, plus a worked example that
// is guaranteed (by construction, see exampleGraphPhrase) to round-trip through rung 3.
const describeCorrective = (requested: string | undefined, candidates: any[]): string => {
  const options = listGraphOptions(candidates);
  const example = candidates.length > 0 ? exampleGraphPhrase(candidates[0]) : undefined;
  const exampleClause = example ? ` Name one, e.g. "${example}".` : " Name one.";
  if (requested === undefined || requested === "") {
    return `No graph is selected. Graphs: ${options}.${exampleClause}`;
  }
  return `No graph matches "${requested}". Graphs: ${options}.${exampleClause}`;
};

// True-duplicate tiebreak (user decision: pick most recent) — applies at rung 2 (resolveByName's
// own "matches more than one") and rung 3 (a scoring tie), before either declares ambiguity. Only
// fires when EVERY tied candidate is content-identical: same normalized display label
// (title/name treated as one identity, same as rawGraphLabel/graphTitlesForDisplay elsewhere in
// this file — CODAP auto-generates a distinct internal `name` like "graph10" per graph even when
// the user-visible title collides, so name is a fallback label, not an independent identity
// field), same plotType, same x/y attribute names, same dataContext. CODAP component ids increase
// monotonically with creation order (never reused, never reassigned), so the highest numeric id
// among content-identical candidates is, by construction, the most recently created one.
const contentKey = (g: any): string => JSON.stringify([
  normalizeName(String(rawGraphLabel(g))),
  g?.plotType ?? null,
  g?.xAttributeName ?? null,
  g?.yAttributeName ?? null,
  g?.dataContext ?? null,
]);

const pickTrueDuplicate = (tied: any[]): any | null => {
  if (tied.length < 2) return null;
  const firstKey = contentKey(tied[0]);
  if (!tied.every((g) => contentKey(g) === firstKey)) return null;
  return tied.reduce((newest, g) => (Number(g?.id) > Number(newest?.id) ? g : newest), tied[0]);
};

// Rung 3: axis + plot-type matching. Runs when rungs 1-2 (resolveByName, above) produce no
// unique hit — including a total miss ("Unknown graph") and a rung-2 ambiguous tie that the
// true-duplicate tiebreak couldn't resolve.
type Rung3Result =
  | { kind: "hit"; value: any }
  | { kind: "tie"; tied: any[] }
  | { kind: "miss" };

const resolveByAxes = (requested: string, graphs: any[]): Rung3Result => {
  const wanted = normalizeName(requested);

  // Plot-type filter: narrows the candidate pool by shape bucket before scoring. Bucketed by
  // graphBucket (plotType-first, axis-presence fallback only when plotType is undefined) — NOT
  // raw axis-presence — so a barChart with one axis is correctly excluded from the dot-plot
  // bucket instead of being misread as a dot plot. If the filter leaves zero graphs, rung 3 fails
  // outright (the caller falls to rung 4) — it must never silently unfilter and score against the
  // full, shape-mismatched pool.
  const wantsScatter = wanted.includes("scatter") || wanted.includes(" vs ") || wanted.includes("versus");
  const wantsDotPlot = wanted.includes("dot plot") || wanted.includes("dotplot") || wanted.includes("univariate");
  let pool = graphs;
  if (wantsScatter) pool = pool.filter((g) => graphBucket(g) === "bivariate");
  else if (wantsDotPlot) pool = pool.filter((g) => graphBucket(g) === "univariate");
  if (pool.length === 0) return { kind: "miss" };

  // Score: +1 per axis attribute name (x, y, legend) whose normalized form is a substring of the
  // normalized request. Substring containment, not token equality, so word order in the request
  // doesn't matter ("mass vs height" must hit both "mass" and "height" regardless of which axis
  // each one is bound to).
  const axisNames = (g: any): string[] =>
    [g?.xAttributeName, g?.yAttributeName, g?.legendAttributeName]
      .filter((n): n is string => typeof n === "string" && n.length > 0);
  const scored = pool.map((g) => ({
    graph: g,
    score: axisNames(g).filter((name) => wanted.includes(normalizeName(name))).length,
  }));
  const maxScore = Math.max(...scored.map((s) => s.score));
  if (maxScore === 0) return { kind: "miss" };
  const winners = scored.filter((s) => s.score === maxScore).map((s) => s.graph);
  if (winners.length === 1) return { kind: "hit", value: winners[0] };

  const deduped = pickTrueDuplicate(winners);
  if (deduped) return { kind: "hit", value: deduped };

  // DAVAI-126 matrix round 3 item E3: word-order tiebreak. Fires only when the true-duplicate
  // tiebreak above did NOT resolve it (these are genuinely different graphs, e.g. axis-swapped
  // mirror images) — evidence (4B/think): "Height vs Mass" tied between the x=Height,y=Mass graph
  // and the x=Mass,y=Height graph, forcing an unnecessary rung-4 ask even though the request's OWN
  // word order already disambiguates which one the user meant. A "<A> vs/versus <B>" phrase names
  // A before the vs-word and B after it — check each tied graph's OWN x/y pair appears in that
  // left-to-right order (A found before the vs-word position, B found after it), not a fixed
  // parse of "the text before/after vs is exactly the x/y name" — so wrapping words ("the mass vs
  // height graph") don't break the match. Fires only when EXACTLY ONE tied graph satisfies this;
  // ties with no vs/versus phrasing, or where zero or more-than-one candidate matches the stated
  // order, fall through to rung 4 exactly as before this fix.
  const vsMatch = wanted.match(/\bvs\b|\bversus\b/);
  if (vsMatch && typeof vsMatch.index === "number") {
    const before = wanted.slice(0, vsMatch.index);
    const after = wanted.slice(vsMatch.index + vsMatch[0].length);
    const orderMatches = winners.filter((g) => {
      const x = typeof g?.xAttributeName === "string" ? normalizeName(g.xAttributeName) : "";
      const y = typeof g?.yAttributeName === "string" ? normalizeName(g.yAttributeName) : "";
      return x.length > 0 && y.length > 0 && before.includes(x) && after.includes(y);
    });
    if (orderMatches.length === 1) return { kind: "hit", value: orderMatches[0] };
  }

  return { kind: "tie", tied: winners };
};

export const resolveGraph = (
  requested: string | undefined,
  graphs: any[],
  selectedGraphId: string | null
): ResolveResult<any> => {
  // Gate 2 boundary coercion (PR #114 review #2 — the exact crash site): callers pass
  // `args.graph as string`, a compile-time-only cast, so a model echoing a printed numeric id
  // back as an unquoted JSON number reaches `requested.trim()` below as a runtime `number`,
  // throwing `TypeError: requested.trim is not a function`. Coerce here, only when DEFINED, so
  // undefined still means "no graph specified" rather than becoming the literal string
  // "undefined".
  if (requested !== undefined) requested = String(requested);
  if (requested === undefined || requested === "") {
    const selected = graphs.find((g) => String(g?.id) === String(selectedGraphId));
    if (selected) return { ok: true, value: selected, repaired: false };
    if (graphs.length === 0) {
      return { ok: false, error: "There are no graphs in this document yet — create one with create_graph." };
    }
    // Rung 4's descriptive listing replaces the old deduped-titles display: two graphs sharing a
    // title are real, distinguishable candidates (different shape/axes), and hiding that behind
    // dedupe is exactly the bug this design fixes.
    return { ok: false, error: describeCorrective(undefined, graphs) };
  }

  // DAVAI-126 matrix round 3 item E2: rung 0, before rung 1 (title/name). A model can only echo
  // back a numeric id if WE printed one to it in the first place (a seed header before E1, or any
  // surface that still falls back to graphLabel's own last-ditch "graph <id>" tier) — evidence:
  // the model faithfully copied the seed's `885090985993956` into get_graph_info/sonify calls and
  // the pre-E2 resolver rejected it outright (5-call flail). An exact id match is unambiguous BY
  // CONSTRUCTION (CODAP ids are unique), so it is never "repaired" — it IS the exact reference,
  // the same way rung 1's exact-title match isn't repaired either. This only ever ACCEPTS ids;
  // E1 makes sure printing one is now a last resort, not the norm. Accepts both the bare id
  // ("885090985993956") and graphLabel's own "graph 885090985993956" phrasing — the CLOSURE
  // requirement (E1) is that whatever graphLabel prints must resolve, and that fallback tier's
  // literal text carries a "graph " prefix.
  const trimmedRequest = requested.trim();
  const idPart = trimmedRequest.replace(/^graph\s+/i, "");
  const exactId = graphs.find((g) => String(g?.id) === trimmedRequest || String(g?.id) === idPart);
  if (exactId) return { ok: true, value: exactId, repaired: false };

  const candidates = graphs.flatMap((g) => {
    const names = [g?.title, g?.name].filter((n): n is string => typeof n === "string" && n.length > 0);
    // Dedupe per-graph: a title/name pair that normalizes identically (e.g. "Heights"/"heights")
    // must contribute exactly one candidate, or resolveByName sees two "matches" for one object
    // and misreports ambiguity.
    const deduped = names.filter((name, i) => names.findIndex((n) => normalizeName(n) === normalizeName(name)) === i);
    return deduped.map((name) => ({ name, value: g }));
  });
  const byName = resolveByName("graph", requested, candidates);
  if (byName.ok) return byName;

  // Rung 2 produced an ambiguous tie (not a total miss) if more than one graph's name normalized
  // to the request. Try the true-duplicate tiebreak on that tied set before falling to rung 3 —
  // a scoring pass over identical graphs would just reproduce the same tie.
  const wanted = normalizeName(requested);
  const rung2Tied = graphs.filter((g) =>
    [g?.title, g?.name].some((n) => typeof n === "string" && normalizeName(n) === wanted));
  if (rung2Tied.length > 1) {
    const deduped = pickTrueDuplicate(rung2Tied);
    if (deduped) return { ok: true, value: deduped, repaired: true };
  }

  const rung3 = resolveByAxes(requested, graphs);
  if (rung3.kind === "hit") return { ok: true, value: rung3.value, repaired: true };

  const candidatesForMessage = rung3.kind === "tie" ? rung3.tied : graphs;
  return { ok: false, error: describeCorrective(requested, candidatesForMessage) };
};

// Backticked identifiers inside CODAP formula/selection expressions, e.g. mean(`Speed`).
export const extractBacktickRefs = (expression: string): string[] => {
  const out: string[] = [];
  const re = /`([^`]+)`/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(expression)) !== null) out.push(m[1]);
  return out;
};
