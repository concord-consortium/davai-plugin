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

// Titles for the no-selection corrective: prefer title, fall back to name, dedupe, drop empties.
// Kept separate from the resolveByName candidate list below (which needs name/title as distinct
// match keys, not a single display label per graph).
const graphTitlesForDisplay = (graphs: any[]): string[] => {
  const titles = graphs.map((g) => g?.title ?? g?.name).filter((n): n is string => typeof n === "string" && n.length > 0);
  return Array.from(new Set(titles));
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
    return {
      ok: false,
      error: `No graph is selected. Available graphs: ${listNames(graphTitlesForDisplay(graphs))}. Name one (by its title), or ask the user to select one.`,
    };
  }
  const candidates = graphs.flatMap((g) => {
    const names = [g?.title, g?.name].filter((n): n is string => typeof n === "string" && n.length > 0);
    // Dedupe per-graph: a title/name pair that normalizes identically (e.g. "Heights"/"heights")
    // must contribute exactly one candidate, or resolveByName sees two "matches" for one object
    // and misreports ambiguity.
    const deduped = names.filter((name, i) => names.findIndex((n) => normalizeName(n) === normalizeName(name)) === i);
    return deduped.map((name) => ({ name, value: g }));
  });
  return resolveByName("graph", requested, candidates);
};

// Backticked identifiers inside CODAP formula/selection expressions, e.g. mean(`Speed`).
export const extractBacktickRefs = (expression: string): string[] => {
  const out: string[] = [];
  const re = /`([^`]+)`/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(expression)) !== null) out.push(m[1]);
  return out;
};
