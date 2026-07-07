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
  requested: string,
  dataContexts: Record<string, any>
): ResolveResult<any> => {
  const candidates = Object.values(dataContexts ?? {}).map((dc: any) => ({ name: dc?.name ?? "", value: dc }));
  return resolveByName("data context", requested, candidates);
};

export const resolveCollection = (
  requested: string | undefined,
  dataContext: any
): ResolveResult<any> => {
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

export const resolveAttribute = (
  requested: string,
  dataContext: any
): ResolveResult<{ attr: any; collection: any }> => {
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
  if (plotType === "dotPlot") return "univariate";
  if (typeof plotType === "string") return "other"; // e.g. "barChart", "binnedDotPlot", etc.
  // plotType undefined: legitimate absence (types.maybe) — fall back to the pre-existing
  // axis-presence heuristic, unchanged from before this fix.
  if (hasX(g) && hasY(g)) return "bivariate";
  if (hasX(g) || hasY(g)) return "univariate";
  return "other";
};

const graphLabel = (g: any): string => g?.title ?? g?.name ?? "";

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
  const axisWord = x ?? y ?? graphLabel(g);
  return `the ${axisWord} ${shapeWord}`;
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
// (title/name treated as one identity, same as graphLabel/graphTitlesForDisplay elsewhere in this
// file — CODAP auto-generates a distinct internal `name` like "graph10" per graph even when the
// user-visible title collides, so name is a fallback label, not an independent identity field),
// same plotType, same x/y attribute names, same dataContext. CODAP component ids increase
// monotonically with creation order (never reused, never reassigned), so the highest numeric id
// among content-identical candidates is, by construction, the most recently created one.
const contentKey = (g: any): string => JSON.stringify([
  normalizeName(String(graphLabel(g))),
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
  return { kind: "tie", tied: winners };
};

export const resolveGraph = (
  requested: string | undefined,
  graphs: any[],
  selectedGraphId: string | null
): ResolveResult<any> => {
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
