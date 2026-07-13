import { getCollectionItemsForAttribute } from "../../codap-api-utils";
import { roundSig } from "../number-format";
import { ILocalTool } from "./registry";
import { resolveAttribute, resolveDataContext } from "./resolve";

// Sample standard deviation (n−1 denominator) to match CODAP's stdDev formula function.
export const computeStats = (values: number[]) => {
  const count = values.length;
  const mean = values.reduce((a, b) => a + b, 0) / count;
  const sorted = [...values].sort((a, b) => a - b);
  const median = count % 2 === 1
    ? sorted[(count - 1) / 2]
    : (sorted[count / 2 - 1] + sorted[count / 2]) / 2;
  const variance = count > 1
    ? values.reduce((a, b) => a + (b - mean) ** 2, 0) / (count - 1)
    : 0;
  return { count, mean, median, stdDev: Math.sqrt(variance), min: sorted[0], max: sorted[count - 1] };
};

// A bare `n.toPrecision(6)` switches to exponential notation once a non-integer value's integer
// part has more digits than the requested precision (e.g. "1.23457e+6" for a large mean) — reads
// badly spoken aloud. roundSig (shared with graph-sketch.ts via number-format.ts) never emits
// e-notation; sig=6 keeps this tool's existing precision level.
const round = (n: number) => roundSig(n, 6);

// Numeric detection by value-sniffing (schema `type` is unreliable in real documents). Exported
// so other consumers (graph-sketch.ts, find-cases.ts) reuse this exact coercion instead of
// duplicating it.
export const coerceNumericValues = (values: unknown[]): number[] =>
  values
    .map((v) => {
      if (typeof v === "number") return v;
      // Whitespace-only strings are blank data, not zero — Number(" ") is a finite 0, which
      // would otherwise count a blank cell as a real numeric zero. Booleans deliberately are NOT
      // guarded here: Number(true)/Number(false) staying 1/0 is intentional (a mean over a
      // boolean attribute is a real "proportion true" statistic), so only strings are trimmed
      // before the blank check.
      const trimmed = typeof v === "string" ? v.trim() : v;
      return trimmed !== "" && trimmed !== null && trimmed !== undefined ? Number(trimmed) : NaN;
    })
    .filter((n): n is number => Number.isFinite(n));

export const getStatsTool: ILocalTool = {
  name: "get_stats",
  description: "Compute count, mean, median, standard deviation, min, and max for a numeric attribute (computed in code from the case values).",
  argsExample: '{"tool": "get_stats", "dataContext": "Mammals", "attribute": "Height"}',
  validate(args, ctx) {
    const dc = resolveDataContext(String(args.dataContext ?? ""), ctx.dataContexts());
    if (!dc.ok) return { ok: false, error: dc.error };
    const attr = resolveAttribute(String(args.attribute ?? ""), dc.value);
    if (!attr.ok) return { ok: false, error: attr.error };
    return { ok: true, resolved: { dataContext: dc.value, attribute: attr.value.attr.name } };
  },
  async execute(resolved, _ctx) {
    const items = await getCollectionItemsForAttribute(resolved.dataContext as any, resolved.attribute as string);
    const numbers = coerceNumericValues(items.map((it: any) => it.values[resolved.attribute as string]));
    if (numbers.length < 2) {
      return `Attribute "${resolved.attribute}" is not numeric enough for statistics (fewer than 2 numeric values among ${items.length} cases). Pick a numeric attribute.`;
    }
    const s = computeStats(numbers);
    return `${resolved.attribute} (computed from ${s.count} numeric cases): mean ${round(s.mean)}, median ${round(s.median)}, standard deviation ${round(s.stdDev)}, min ${round(s.min)}, max ${round(s.max)}.`;
  },
};
