import {
  getCollectionItemsForAttribute, getCollectionItemsForAttributePair, getGraphAdornments, getGraphByID,
  IAdornmentData
} from "../codap-api-utils";
import { computeGraphSketch } from "./graph-sketch";
import { graphLabel } from "./tools/resolve";

// One adornment as prompt text. LSRL carries slope/intercept/rSquared rather than value or
// mean/min/max, so it needs its own branch (the fallback would render "mean undefined, min
// undefined, max undefined"); the format matches create-adornment.ts's formatData so the model
// sees one consistent LSRL phrasing. Exported so get-graph-info.ts (the tool's own adornments
// line) reuses this exact formatting instead of duplicating it. Every field is guarded (PR #114
// review item 11) so a malformed/incomplete adornment (e.g. a legend-split multi-line LSRL
// missing one of these fields) never renders the literal text "undefined".
export const formatAdornment = (a: IAdornmentData): string =>
  a.type === "LSRL"
    ? `${a.type}: slope ${a.slope ?? "unavailable"}, intercept ${a.intercept ?? "unavailable"}, ` +
      `R² ${a.rSquared ?? "unavailable"}`
    : `${a.type}: ${a.value ?? `mean ${a.mean ?? "unavailable"}, min ${a.min ?? "unavailable"}, max ${a.max ?? "unavailable"}`}`;

// The sonification store's explicit selection wins; otherwise, when the document has exactly
// one graph, that graph is unambiguously "the graph" — clicking a graph in CODAP does not
// set the store's selection, so single-graph documents must not demand a manual pick.
export const deriveCurrentGraphId = (
  selectedGraphId: string | number | null | undefined,
  graphs: any[]
): string | null => {
  if (selectedGraphId !== null && selectedGraphId !== undefined && selectedGraphId !== "") return String(selectedGraphId);
  if (graphs.length === 1 && graphs[0]?.id !== undefined) return String(graphs[0].id);
  return null;
};

// "Mammals — Cases: Height (numeric), Habitat (categorical), Mass" normally, or
// "Height (numeric, meters)" when the attribute object carries a `unit` field (DAVAI-126 Task B
// — fail-soft, only shown when present; an attribute with no `unit` keeps the plain "(type)"
// format, and one with no `type` at all stays a bare name, same as before this addition).
// Replaces the raw trimmed-JSON context dump (smaller, and no IDs for the model to fixate on).
// Every name field is guarded with `?? ""` (PR #114 review item 11) so a dataContext, collection,
// or attribute missing its own `name` never renders the literal text "undefined" into the digest.
export const buildSchemaDigest = (dataContexts: Record<string, any>): string =>
  Object.values(dataContexts ?? {})
    .map((dc: any) => {
      const collections = (dc?.collections ?? [])
        .map((c: any) => {
          const attrs = (c?.attrs ?? [])
            .map((a: any) => {
              if (!a?.type) return a?.name ?? "";
              return a?.unit ? `${a.name ?? ""} (${a.type}, ${a.unit})` : `${a.name ?? ""} (${a.type})`;
            })
            .join(", ");
          return `${c?.name ?? ""}: ${attrs}`;
        })
        .join(" | ");
      return `${dc?.name ?? ""} — ${collections}`;
    })
    .join("\n");

// Reads the CODAP data-interactive `unit` field off the named attribute, if the data context
// object (and CODAP's response) happens to carry one — the raw attribute objects here are the
// same shape codap-plugin-api's `Attribute` type documents (name/type/precision/unit/...), and
// trimDataset (codap-api-utils.ts) only strips `_categoryMap`, so `unit` survives into this
// state untouched whenever CODAP populates it. Plumbed fail-soft: undefined whenever the field
// is absent, never a new CODAP request. Exported so get-graph-info.ts (the tool's own sketch
// wiring) reuses this exact lookup instead of duplicating it.
export const findAttributeUnit = (dataContext: any, attributeName: string | null): string | undefined => {
  if (!attributeName) return undefined;
  for (const collection of dataContext?.collections ?? []) {
    const attr = (collection?.attrs ?? []).find((a: any) => a?.name === attributeName);
    if (attr?.unit) return String(attr.unit);
  }
  return undefined;
};

// Deterministic pre-seed for the selected graph: structure + visible adornments + ALL case
// values (DAVAI-126 user directive: no sampling — every value ships). Fails soft (empty
// string) — a missing seed degrades to tool calls, never to a broken turn. The prompt's own
// trim rung (trimToBudget in local-llm-prompt.ts) is the intentional overflow behavior for huge
// datasets: it drops this whole values line under budget pressure rather than sampling it.
//
// DAVAI-126 Task B: the sketch (computeGraphSketch — computed cluster/outlier/relationship facts
// a small local model cannot reliably derive itself) is inserted here in the STRUCTURE section,
// between the axes/adornments line and the Values line — NOT appended to the Values line — so it
// survives trimToBudget's trim rung, which blanks only the line starting literally with "Values"
// (SEED_VALUES_PREFIX in local-llm-prompt.ts). It reuses the very same `items` already fetched
// for the Values line below (no second CODAP round trip).
export const buildGraphSeed = async (
  graphId: string,
  dataContexts: Record<string, any>
): Promise<string> => {
  try {
    const graph = await getGraphByID(graphId);
    const x = graph?.xAttributeName ?? null;
    const y = graph?.yAttributeName ?? null;
    if (!x && !y) return "";
    const dc = Object.values(dataContexts ?? {}).find((d: any) => d?.name === graph?.dataContext);
    if (!dc) return "";

    const adornments = await getGraphAdornments(Number(graphId));
    const adornmentText = adornments.length
      ? adornments.map(formatAdornment).join("; ")
      : "none";

    const items = x && y
      ? await getCollectionItemsForAttributePair(dc, x, y)
      : await getCollectionItemsForAttribute(dc, (x ?? y) as string);
    const rows = items
      .map((it: any) => (x && y ? `${it.values[x]}, ${it.values[y]}` : String(it.values[(x ?? y) as string])))
      .join("; ");

    const sketch = x && y
      ? computeGraphSketch({
          xName: x, yName: y,
          xValues: items.map((it: any) => it.values[x]), yValues: items.map((it: any) => it.values[y]),
          xUnit: findAttributeUnit(dc, x), yUnit: findAttributeUnit(dc, y),
          adornments,
        })
      : computeGraphSketch({
          xName: (x ?? y) as string,
          xValues: items.map((it: any) => it.values[(x ?? y) as string]),
          xUnit: findAttributeUnit(dc, x ?? y),
        });

    // DAVAI-126 matrix round 3 item E1: was `graph?.title ?? graph?.name ?? graphId` — a raw id
    // fallback the model would then have to echo back verbatim (evidence: seed handing out
    // `885090985993956`). graphLabel is empty-string-safe and prefers a descriptive, resolvable
    // phrase over a bare id.
    const lines = [
      `Selected graph "${graphLabel(graph)}" (data context: ${graph?.dataContext}).`,
      `x-axis: ${x ?? "(none)"}; y-axis: ${y ?? "(none)"}. Adornments: ${adornmentText}.`,
    ];
    if (sketch) lines.push(sketch);
    lines.push(`Values${x && y ? ` (${x}, ${y})` : ` (${x ?? y})`} — ${items.length} cases: ${rows}`);
    return lines.join("\n");
  } catch {
    return "";
  }
};
