import { coerceNumericValues } from "./tools/get-stats";
// Re-exported (not just imported) so existing consumers of `roundSig` from THIS module (e.g.
// graph-sketch.test.ts) are unaffected — the implementation moved to number-format.ts so
// get-stats.ts can reuse it too without a get-stats.ts <-> graph-sketch.ts circular import
// (graph-sketch.ts already imports coerceNumericValues FROM get-stats.ts).
import { roundSig } from "./number-format";
export { roundSig };

// DAVAI-126 Task B: local models (esp. the 1.7B) cannot reliably derive cluster boundaries,
// outliers, or R²-meaning from raw case values — a 1.7B run invented "data points clustering
// around the LSRL" that wasn't true. Rule from this project: anything we want said reliably is
// computed client-side and handed over as text — describing becomes transcription. This module
// is pure (no CODAP calls) so it's trivially testable and reusable from both prefetch (the seed)
// and the get_graph_info tool result.

export interface IGraphAdornmentInput {
  type: string;
  value?: number;
  slope?: number;
  intercept?: number;
  rSquared?: number;
}

export interface IGraphSketchInput {
  xName: string;
  yName?: string;
  xValues: unknown[];
  yValues?: unknown[];
  xUnit?: string;
  yUnit?: string;
  adornments?: IGraphAdornmentInput[];
  // Raw [x, y] coordinate pairs the user has currently selected in CODAP (not necessarily
  // numeric-filtered — only used for the coordinate display, never for statistics).
  selectedPairs?: [unknown, unknown][];
}

// DAVAI-126 Task H: live hallucination report — a Mammals "Diet vs. Habitat" graph (both
// categorical axes) produced an EMPTY sketch under the numeric-only Task B logic (coercion left
// fewer than 2 numeric values on either axis), so get_graph_info handed the model structure only
// and it filled the vacuum with invented world-knowledge categories ("herbivore, carnivore,
// omnivore", "forest, grassland, aquatic") that don't exist anywhere in the data. The fix is
// structural, matching Task B's own philosophy: detect what KIND of data each axis holds and
// hand over the real facts for that kind, so describing becomes transcription either way.
export type AxisKind = "numeric" | "categorical";

// An axis is NUMERIC when MORE than 80% of its non-empty values coerce via the shared
// coerceNumericValues (get_stats's own coercion — reused, never modified here). The threshold is
// strictly ">80%", not ">=80%", per the brief: exactly 80% is categorical. Empty values ("", null,
// undefined) are excluded from BOTH the numerator and denominator — they carry no signal about
// the axis's type either way, and counting them toward the categorical side would understate a
// genuinely-numeric axis that merely has some missing values (a common, unremarkable case in real
// CODAP documents).
const isEmpty = (v: unknown): boolean => v === "" || v === null || v === undefined;

// Whitespace-only strings ("   ") are treated as empty for the SAME reason a blank string is:
// M-k (the tracked follow-up on coerceNumericValues's own quirks) documents that Number("   ")
// is 0 — a finite number — so an untrimmed whitespace-only value would silently count as numeric
// evidence. Left untrimmed, a handful of such values (a common data-entry artifact) can tip an
// obviously-categorical, mostly-blank axis over the 80% line into "numeric", producing a nonsense
// "range 0-0" sketch instead of the correct categorical one. Trimming before the emptiness check
// makes THIS threshold robust to that quirk without modifying coerceNumericValues itself — the
// same trim-then-check order nonEmptyCategoryStrings (below) already uses for category labels.
const isEmptyForAxisType = (v: unknown): boolean => isEmpty(typeof v === "string" ? v.trim() : v);

export const isNumericAxis = (values: unknown[]): boolean => {
  const nonEmpty = values.filter((v) => !isEmptyForAxisType(v));
  if (nonEmpty.length === 0) return false;
  const numericCount = coerceNumericValues(nonEmpty).length;
  return numericCount / nonEmpty.length > 0.8;
};

// Tukey hinges: median of the lower half and median of the upper half, excluding the overall
// median itself when n is odd. This is the same "most between" split the brief's own worked
// examples use (Height 0.7-2.2 as Q1-Q3 on a presumably-27-point fixture) and is the most common
// definition students encounter for the box-and-whisker Q1/Q3 CODAP itself draws.
const median = (sorted: number[]): number => {
  const n = sorted.length;
  return n % 2 === 1 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
};

const quartiles = (values: number[]): { q1: number; q3: number } => {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const mid = Math.floor(n / 2);
  const lower = sorted.slice(0, mid);
  const upper = n % 2 === 0 ? sorted.slice(mid) : sorted.slice(mid + 1);
  return { q1: median(lower), q3: median(upper) };
};

const iqrFences = (q1: number, q3: number): { lo: number; hi: number } => {
  const iqr = q3 - q1;
  return { lo: q1 - 1.5 * iqr, hi: q3 + 1.5 * iqr };
};

// IQR outliers for one labeled axis, largest |deviation from the median| first, capped at `max`.
// Each entry carries the value, its ORIGINAL index in the input array (so scatter callers can
// pair it with the other axis's value at that same index — a value-based re-lookup like
// `otherAxis[values.indexOf(outlier.value)]` would misattribute whenever two outlier cases
// happen to share an identical value on this axis), and whether it fell above or below the
// fence side (for the "far above/below the rest" univariate wording).
interface IAxisOutlier { value: number; index: number; aboveMedian: boolean; }
const findAxisOutliers = (values: number[], max: number): IAxisOutlier[] => {
  const sorted = [...values].sort((a, b) => a - b);
  const { q1, q3 } = quartiles(sorted);
  const med = median(sorted);
  const { lo, hi } = iqrFences(q1, q3);
  return values
    .map((value, index) => ({ value, index, aboveMedian: value > med }))
    .filter((o) => o.value < lo || o.value > hi)
    .sort((a, b) => Math.abs(b.value - med) - Math.abs(a.value - med))
    .slice(0, max);
};

const pearsonR = (xs: number[], ys: number[]): number => {
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  const cov = xs.reduce((sum, x, i) => sum + (x - mx) * (ys[i] - my), 0);
  const sdx = Math.sqrt(xs.reduce((sum, x) => sum + (x - mx) ** 2, 0));
  const sdy = Math.sqrt(ys.reduce((sum, y) => sum + (y - my) ** 2, 0));
  return cov / (sdx * sdy);
};

// |r| < 0.3 weak, < 0.7 moderate, else strong — spec-defined boundaries (inclusive on the
// moderate side at both 0.3 and 0.7). Task B review fix (coherence-for-audio): the caller passes
// the DISPLAYED r (already rounded to 2 sig figs), not the true r — a blind listener hears the
// word and the number as one unit, and deciding the word from the true r produces contradictions
// like "moderate (r = 0.7)" (true r 0.6999...) or "weak (r = 0.3)" (true r 0.299...) exactly at
// the boundaries. The word must always agree with the number actually spoken.
const strengthWord = (displayedR: number): string => {
  const abs = Math.abs(displayedR);
  if (abs < 0.3) return "weak";
  if (abs < 0.7) return "moderate";
  return "strong";
};

const directionWord = (r: number): string => (r < 0 ? "negative" : "positive");

// PR #114 review item 11 (LSRL graceful degrade): extends the existing slope/intercept type-check
// to ALSO reject a rSquared that's PRESENT but not a number (e.g. array-shaped, from a
// hypothetical legend-split multi-line representation) — without changing behavior for the
// verified, already-working shape, where rSquared is either a real number or simply absent
// (handled by the `?? r * r` fallback in buildScatterSketch). A malformed rSquared makes the
// WHOLE adornment ineligible, falling through to the per-axis-outliers branch instead of
// embedding a broken value into the LSRL/R² line (e.g. "explains about NaN% of the variation").
//
// Codex second-pass hardening F2: `typeof x === "number"` is TRUE for NaN, so a NaN slope or
// intercept used to slip through this check — Number.isFinite rejects it too, the same graceful
// degrade a malformed-TYPE rSquared already gets. rSquared keeps its ORIGINAL (typeof, not
// finiteness) check here: a present-but-NaN rSquared alone must not reject an otherwise-good
// slope/intercept fit — the finiteness check at render time (below) is what suppresses just the
// R²-dependent sentence for that specific case, leaving the equation line intact.
const findLSRL = (adornments: IGraphAdornmentInput[] | undefined): IGraphAdornmentInput | undefined =>
  adornments?.find((a) =>
    a.type === "LSRL" &&
    Number.isFinite(a.slope) &&
    Number.isFinite(a.intercept) &&
    (a.rSquared === undefined || typeof a.rSquared === "number")
  );

// Residual outliers (y minus the fitted value), largest |residual| first, capped at `max`. Each
// entry keeps the original (x, y) pair so the "Farthest from the line" line can report
// coordinates, not just the residual magnitude.
interface IResidualOutlier { x: number; y: number; residual: number; }
const findResidualOutliers = (xs: number[], ys: number[], slope: number, intercept: number, max: number): IResidualOutlier[] => {
  const residuals = xs.map((x, i) => ({ x, y: ys[i], residual: ys[i] - (slope * x + intercept) }));
  const values = residuals.map((r) => r.residual);
  const { q1, q3 } = quartiles(values);
  const { lo, hi } = iqrFences(q1, q3);
  return residuals
    .filter((r) => r.residual < lo || r.residual > hi)
    .sort((a, b) => Math.abs(b.residual) - Math.abs(a.residual))
    .slice(0, max);
};

const MAX_OUTLIERS = 3;
const MAX_SELECTED = 3;

// "Height (meters) 0.1–6.5" or "Height 0.1–6.5" depending on whether a unit was supplied.
const axisRangeClause = (name: string, unit: string | undefined, min: number, max: number, q1: number, q3: number): string => {
  const unitClause = unit ? ` (${unit})` : "";
  return `${name}${unitClause} ${roundSig(min)}–${roundSig(max)} (most between ${roundSig(q1)} and ${roundSig(q3)})`;
};

const formatCoord = (x: number, y: number): string => `(${roundSig(x)}, ${roundSig(y)})`;

// DAVAI-126 Task H: reports which sketch MODE computeGraphSketch would produce (or will produce)
// for this input, without duplicating the axis-type decision anywhere else — get_graph_info uses
// this to pick the matching checklist trailer (a numeric-flavored "outliers above" checklist
// makes no sense appended to a categorical sketch). Exported so callers never have to re-derive
// axis kind from the sketch's own prose.
export type SketchMode = "numeric-univariate" | "numeric-scatter" | "categorical" | "categorical-numeric" | "none";

export const getSketchMode = (input: IGraphSketchInput): SketchMode => {
  const hasY = input.yName !== undefined && input.yValues !== undefined;
  if (!hasY) return isNumericAxis(input.xValues) ? "numeric-univariate" : "categorical";
  const xNumeric = isNumericAxis(input.xValues);
  const yNumeric = isNumericAxis(input.yValues as unknown[]);
  if (xNumeric && yNumeric) return "numeric-scatter";
  if (!xNumeric && !yNumeric) return "categorical";
  return "categorical-numeric";
};

export const computeGraphSketch = (input: IGraphSketchInput): string => {
  const hasY = input.yName !== undefined && input.yValues !== undefined;

  if (!hasY) {
    // Axis-type detection (H1) decides which builder runs; each builder owns its own
    // fewer-than-2-points fail-soft check so "" is returned uniformly either way.
    if (isNumericAxis(input.xValues)) {
      const xNumbers = coerceNumericValues(input.xValues);
      if (xNumbers.length < 2) return "";
      return buildUnivariateSketch(input.xName, input.xUnit, xNumbers);
    }
    return buildUnivariateCategoricalSketch(input.xName, input.xValues);
  }

  const yValuesRaw = input.yValues as unknown[];
  const xNumeric = isNumericAxis(input.xValues);
  const yNumeric = isNumericAxis(yValuesRaw);

  if (xNumeric && yNumeric) {
    // Scatter: only cases numeric on BOTH axes form a valid pair (index-aligned with xValues).
    // Byte-identical to pre-Task-H behavior — this branch is untouched from the original code.
    const pairs: { x: number; y: number }[] = [];
    input.xValues.forEach((rawX, i) => {
      const [x] = coerceNumericValues([rawX]);
      const [y] = coerceNumericValues([yValuesRaw[i]]);
      if (x !== undefined && y !== undefined) pairs.push({ x, y });
    });
    if (pairs.length < 2) return "";
    return buildScatterSketch(input, pairs);
  }

  if (!xNumeric && !yNumeric) {
    return buildCategoricalCrosstabSketch(input.xName, input.xValues, input.yName as string, yValuesRaw);
  }

  // Exactly one axis is categorical, the other numeric — orientation-independent: always reports
  // "<numeric attribute> by <categorical attribute>" regardless of which one is x or y. When x is
  // the numeric one, pass (xName, xValues) as the numeric args and (yName, yValues) as the
  // categorical args; when y is numeric, it's the reverse.
  return xNumeric
    ? buildCategoricalByNumericSketch(input.xName, input.xValues, input.yName as string, yValuesRaw)
    : buildCategoricalByNumericSketch(input.yName as string, yValuesRaw, input.xName, input.xValues);
};

const buildUnivariateSketch = (name: string, unit: string | undefined, values: number[]): string => {
  const { q1, q3 } = quartiles(values);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const lines = [`Sketch: ${values.length} points. ${axisRangeClause(name, unit, min, max, q1, q3)}.`];

  const outliers = findAxisOutliers(values, MAX_OUTLIERS);
  if (outliers.length > 0) {
    const parts = outliers.map((o) => `${roundSig(o.value)} (far ${o.aboveMedian ? "above" : "below"} the rest)`);
    lines.push(`Outliers: ${parts.join(", ")}.`);
  }
  return lines.join("\n");
};

// PR #114 review item 4: splits one axis's IQR outliers (already sorted largest-|deviation|-first
// by findAxisOutliers) into "high"/"low" clauses. Pre-fix, the word came from outliers[0] ONLY
// (the single largest-deviation entry) and was then applied to every OTHER listed value on that
// axis too — so a low outlier with a smaller deviation than a same-axis high one was read out
// under "Unusually high", contradicting the coordinate actually spoken. Each side keeps
// findAxisOutliers' own largest-deviation-first order (filter preserves relative order).
const formatSideOutliers = (
  axisName: string, outliers: IAxisOutlier[], coordFor: (o: IAxisOutlier) => string
): string[] => {
  const above = outliers.filter((o) => o.aboveMedian);
  const below = outliers.filter((o) => !o.aboveMedian);
  const clauses: string[] = [];
  if (above.length > 0) clauses.push(`Unusually high ${axisName}: ${above.map(coordFor).join(", ")}`);
  if (below.length > 0) clauses.push(`Unusually low ${axisName}: ${below.map(coordFor).join(", ")}`);
  return clauses;
};

// PR #114 review item 11 (selectedPairs formatting hardening): a non-numeric coordinate already
// dropped its whole pair from `coords` via the length-2 filter, but the reported count used
// selectedPairs.length (the ORIGINAL, pre-filter count) — miscounting how many are actually
// listed. Using coords.length instead keeps the stated count honest, AND naturally covers the
// all-non-numeric case: `undefined` is returned when nothing survives, so the caller omits the
// line entirely instead of the old "Selected: N cases at ." (an empty, nonsensical clause).
const buildSelectedLine = (selectedPairs: [unknown, unknown][]): string | undefined => {
  const coords = selectedPairs
    .map(([x, y]) => coerceNumericValues([x, y]))
    .filter((c) => c.length === 2)
    .map(([x, y]) => formatCoord(x, y));
  if (coords.length === 0) return undefined;
  const count = coords.length;
  const noun = count === 1 ? "case" : "cases";
  const shown = coords.slice(0, MAX_SELECTED);
  const more = coords.length - shown.length;
  const coordText = more > 0 ? `${shown.join(", ")} … and ${more} more` : shown.join(", ");
  return `Selected: ${count} ${noun} at ${coordText}.`;
};

const buildScatterSketch = (input: IGraphSketchInput, pairs: { x: number; y: number }[]): string => {
  const xs = pairs.map((p) => p.x);
  const ys = pairs.map((p) => p.y);
  const { q1: q1x, q3: q3x } = quartiles(xs);
  const { q1: q1y, q3: q3y } = quartiles(ys);

  const lines = [
    `Sketch: ${pairs.length} points. ` +
      `${axisRangeClause(input.xName, input.xUnit, Math.min(...xs), Math.max(...xs), q1x, q3x)}; ` +
      `${axisRangeClause(input.yName as string, input.yUnit, Math.min(...ys), Math.max(...ys), q1y, q3y)}.`,
  ];

  // PR #114 review item 3: pearsonR's denominator (sdx * sdy) is 0 whenever EITHER axis is
  // constant, producing NaN — which read as the confidently-wrong "positive, strong (r = NaN)"
  // plus a "NaN%" R² line. An undefined correlation is a real fact, not a defect: state it
  // plainly and skip the entire r-dependent remainder (LSRL/R², per-axis outliers) — none of
  // those numbers are meaningful either when one axis never varies (its own IQR fences collapse
  // to a single point, so "outliers" on that axis are vacuous, and an LSRL slope/R² fit to a
  // vertical or horizontal scatter does not describe what its numbers would claim).
  const xConstant = xs.every((x) => x === xs[0]);
  const yConstant = ys.every((y) => y === ys[0]);
  if (xConstant || yConstant) {
    const constantNames = [xConstant ? input.xName : undefined, yConstant ? (input.yName as string) : undefined]
      .filter((n): n is string => n !== undefined);
    lines.push(`Relationship: undefined — every point has the same ${constantNames.join(" and ")}.`);
    if (input.selectedPairs && input.selectedPairs.length > 0) {
    const selectedLine = buildSelectedLine(input.selectedPairs);
    if (selectedLine) lines.push(selectedLine);
  }
    return lines.join("\n");
  }

  const r = pearsonR(xs, ys);
  if (r === 0) {
    // directionWord(0) reads "positive" today, asserting a direction that doesn't exist for an
    // exactly-uncorrelated (but otherwise valid, non-degenerate) pair — state the fact plainly.
    lines.push("Relationship: no linear relationship (r = 0).");
  } else {
    // Round for display FIRST, then derive the strength word FROM the displayed value (see
    // strengthWord's comment) — the word must never contradict the number the listener hears.
    // Direction still keys off the true r's sign (roundSig preserves sign, so they can't differ).
    const rDisplay = roundSig(r, 2);
    lines.push(`Relationship: ${directionWord(r)}, ${strengthWord(Number(rDisplay))} (r = ${rDisplay}).`);
  }

  const lsrl = findLSRL(input.adornments);
  if (lsrl) {
    const slope = lsrl.slope as number;
    const intercept = lsrl.intercept as number;
    const interceptClause = intercept < 0 ? `− ${roundSig(Math.abs(intercept))}` : `+ ${roundSig(intercept)}`;
    const equation = `LSRL: ${input.yName} = ${roundSig(slope)} × ${input.xName} ${interceptClause}`;
    // Clamp to 1: R² cannot exceed 1 by definition — a slightly-over-1 value (CODAP's own
    // adornment data, or in principle our r*r fallback) is a floating-point artifact, never a
    // real >100%-of-the-variation result (PR #114 review item 3).
    const rSquared = Math.min(1, lsrl.rSquared ?? r * r);
    // Codex second-pass hardening F2: rSquared can be PRESENT but non-finite (e.g. NaN) even
    // though slope/intercept are both finite — findLSRL only checks rSquared's TYPE (so the
    // `?? r * r` fallback above still fires when it's simply absent), not its finiteness.
    // Rendering the R² sentence anyway would embed a literal "NaN%" (Math.round(NaN) is NaN).
    // Omit ONLY that sentence; the equation line (independently finite-guarded via findLSRL)
    // still stands on its own.
    lines.push(
      Number.isFinite(rSquared)
        ? `${equation}; R² = ${roundSig(rSquared)} — ` +
          `${input.xName} explains about ${Math.round(rSquared * 100)}% of the variation in ${input.yName}.`
        : `${equation}.`
    );

    const residualOutliers = findResidualOutliers(xs, ys, slope, intercept, MAX_OUTLIERS);
    if (residualOutliers.length > 0) {
      lines.push(`Farthest from the line: ${formatResidualOutliers(residualOutliers)}.`);
    }
  } else {
    // Pair each outlier with the OTHER axis's value at that same original index — never a
    // value-based re-lookup, which would misattribute if two outlier cases share an identical
    // value on the outlier axis (see graph-sketch.test.ts's duplicate-value regression case).
    const xOutliers = findAxisOutliers(xs, MAX_OUTLIERS);
    const yOutliers = findAxisOutliers(ys, MAX_OUTLIERS);
    const unusualParts: string[] = [
      ...formatSideOutliers(input.xName, xOutliers, (o) => formatCoord(o.value, ys[o.index])),
      ...formatSideOutliers(input.yName as string, yOutliers, (o) => formatCoord(xs[o.index], o.value)),
    ];
    if (unusualParts.length > 0) lines.push(`${unusualParts.join("; ")}.`);
  }

  if (input.selectedPairs && input.selectedPairs.length > 0) {
    const selectedLine = buildSelectedLine(input.selectedPairs);
    if (selectedLine) lines.push(selectedLine);
  }

  return lines.join("\n");
};

// Joins 1-3 coordinate strings in natural English: "(a)" / "(a) and (b)" / "(a), (b) and (c)".
const joinCoords = (coords: string[]): string => {
  if (coords.length <= 1) return coords.join("");
  if (coords.length === 2) return coords.join(" and ");
  return `${coords.slice(0, -1).join(", ")} and ${coords[coords.length - 1]}`;
};

// "(4, 6400) and (3, 5000) far above; (6.5, 4000) below" — groups the (already largest-|residual|
// -first sorted) outliers by which side of the line they fell on, saying "far above"/"below"
// once per non-empty group rather than once per coordinate, joined by "; " only when both groups
// are non-empty (so a single-sided result reads as one clause, not a stray trailing semicolon).
const formatResidualOutliers = (outliers: IResidualOutlier[]): string => {
  const above = outliers.filter((o) => o.residual > 0);
  const below = outliers.filter((o) => o.residual <= 0);
  const clauses: string[] = [];
  if (above.length > 0) clauses.push(`${joinCoords(above.map((o) => formatCoord(o.x, o.y)))} far above`);
  if (below.length > 0) clauses.push(`${joinCoords(below.map((o) => formatCoord(o.x, o.y)))} below`);
  return clauses.join("; ");
};

// ---------------------------------------------------------------------------------------------
// DAVAI-126 Task H: categorical sketch modes (univariate categorical, categorical x categorical,
// categorical x numeric). All three reuse the RAW string values directly — never coerced,
// because coercion is precisely what erased the category names in the live hallucination report
// (a categorical axis's values ARE its facts; there is nothing to compute from them beyond
// counting). Empty/blank values are trimmed and excluded from categories (and from the count)
// per the brief: "exclude and let counts reflect non-empty".
// ---------------------------------------------------------------------------------------------

const MAX_AXIS_CATEGORIES = 8;
const MAX_CATEGORICAL_ROWS = 6; // cat x num per-category summary cap, and univariate-elsewhere n/a
const MAX_COMBINATIONS = 6;
const MAX_EMPTY_COMBINATIONS = 4;

// Trims and drops empty strings/null/undefined, coercing every surviving raw value to its string
// form (categorical axes are inherently string-labeled — a stray non-string like a boolean or a
// number that happens to sit on an otherwise-categorical axis still gets a legible label here).
const nonEmptyCategoryStrings = (values: unknown[]): string[] =>
  values
    .map((v) => (typeof v === "string" ? v.trim() : v))
    .filter((v) => !isEmpty(v))
    .map((v) => String(v));

interface ICategoryCount { category: string; count: number; }

// Distinct categories with their counts, sorted by descending count (ties keep first-seen order,
// via Array.sort's stability, so output is deterministic across runs on the same data).
const categoryCounts = (values: string[]): ICategoryCount[] => {
  const counts = new Map<string, number>();
  values.forEach((v) => counts.set(v, (counts.get(v) ?? 0) + 1));
  return [...counts.entries()]
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count);
};

// "meat (11), both (9), plants (7)" capped at `max`, with "… and N more" appended when truncated
// — same cap-then-ellipsis convention the numeric Selected-pairs line already established.
const formatCategoryList = (counts: ICategoryCount[], max: number): string => {
  const shown = counts.slice(0, max);
  const text = shown.map((c) => `${c.category} (${c.count})`).join(", ");
  const more = counts.length - shown.length;
  return more > 0 ? `${text} … and ${more} more` : text;
};

const buildUnivariateCategoricalSketch = (name: string, rawValues: unknown[]): string => {
  const values = nonEmptyCategoryStrings(rawValues);
  if (values.length < 2) return "";
  return `${name}: ${formatCategoryList(categoryCounts(values), MAX_AXIS_CATEGORIES)}.`;
};

// Categorical x categorical: point count, per-axis category breakdowns, the largest nonzero
// crosstab cells, and (when few enough exist) the empty cells — every number here is a real
// count from the data, so a listener never hears an invented category name.
const buildCategoricalCrosstabSketch = (
  xName: string, xRawValues: unknown[], yName: string, yRawValues: unknown[]
): string => {
  // Only cases with a non-empty value on BOTH axes form a valid pair, index-aligned with xValues
  // (mirrors the numeric scatter path's own pairing rule just above).
  const pairs: { x: string; y: string }[] = [];
  xRawValues.forEach((rawX, i) => {
    const x = nonEmptyCategoryStrings([rawX])[0];
    const y = nonEmptyCategoryStrings([yRawValues[i]])[0];
    if (x !== undefined && y !== undefined) pairs.push({ x, y });
  });
  if (pairs.length < 2) return "";

  const xCounts = categoryCounts(pairs.map((p) => p.x));
  const yCounts = categoryCounts(pairs.map((p) => p.y));

  // Cell counts keyed by JSON.stringify([x, y]) rather than a joined/delimited string --
  // category names are free-form user text and may contain spaces or any other character, so a
  // plain "x y"-style join-then-split key would be ambiguous (or outright wrong) for multi-word
  // category names. JSON-encoding a 2-tuple properly escapes embedded characters and is safe to
  // round-trip through JSON.parse without any delimiter assumption.
  const cellCounts = new Map<string, number>();
  pairs.forEach((p) => {
    const key = JSON.stringify([p.x, p.y]);
    cellCounts.set(key, (cellCounts.get(key) ?? 0) + 1);
  });
  const nonzeroCells = [...cellCounts.entries()]
    .map(([key, count]) => {
      const [x, y] = JSON.parse(key) as [string, string];
      return { x, y, count };
    })
    .sort((a, b) => b.count - a.count);

  const shownCombos = nonzeroCells.slice(0, MAX_COMBINATIONS);
  const comboText = shownCombos.map((c) => `${c.x} & ${c.y} (${c.count})`).join(", ");
  const moreCombos = nonzeroCells.length - shownCombos.length;
  const combosLine = moreCombos > 0
    ? `Largest combinations: ${comboText} … and ${moreCombos} more combinations.`
    : `Largest combinations: ${comboText}.`;

  const lines = [
    `Sketch: ${pairs.length} points (two categorical attributes).`,
    `${xName} (x): ${formatCategoryList(xCounts, MAX_AXIS_CATEGORIES)}. ` +
      `${yName} (y): ${formatCategoryList(yCounts, MAX_AXIS_CATEGORIES)}.`,
    combosLine,
  ];

  // Empty combinations (informative for a listener — "no meat-loving water dwellers" is itself a
  // fact) are appended ONLY when there are few enough to be worth reading aloud: capped at 4,
  // omitted entirely once there are more than that.
  const emptyCells: string[] = [];
  for (const xc of xCounts) {
    for (const yc of yCounts) {
      if (!cellCounts.has(JSON.stringify([xc.category, yc.category]))) {
        emptyCells.push(`${xc.category} & ${yc.category}`);
      }
    }
  }
  if (emptyCells.length > 0 && emptyCells.length <= MAX_EMPTY_COMBINATIONS) {
    lines.push(`Empty combinations: ${emptyCells.join(", ")}.`);
  }

  return lines.join("\n");
};

// Categorical x numeric (either orientation — the caller always passes the numeric attribute
// first so the sentence always reads "<numeric> by <categorical>" regardless of which one was x
// or y in the original graph): per-category median + range of the numeric attribute, categories
// by descending count, capped at 6.
const buildCategoricalByNumericSketch = (
  numericName: string, numericRawValues: unknown[], categoricalName: string, categoricalRawValues: unknown[]
): string => {
  // Only cases with a non-empty category AND a coercible number form a valid pair, index-aligned
  // with the categorical axis's original array (mirrors the numeric scatter path's pairing rule).
  const pairs: { category: string; value: number }[] = [];
  categoricalRawValues.forEach((rawCategory, i) => {
    const category = nonEmptyCategoryStrings([rawCategory])[0];
    const [value] = coerceNumericValues([numericRawValues[i]]);
    if (category !== undefined && value !== undefined) pairs.push({ category, value });
  });
  if (pairs.length < 2) return "";

  const byCategory = new Map<string, number[]>();
  pairs.forEach((p) => {
    const list = byCategory.get(p.category) ?? [];
    list.push(p.value);
    byCategory.set(p.category, list);
  });

  const rows = [...byCategory.entries()]
    .map(([category, values]) => ({ category, values, count: values.length }))
    .sort((a, b) => b.count - a.count);

  const shown = rows.slice(0, MAX_CATEGORICAL_ROWS);
  const summaries = shown.map(({ category, values, count }) => {
    const sorted = [...values].sort((a, b) => a - b);
    const med = median(sorted);
    const noun = count === 1 ? "case" : "cases";
    return `${category} (${count} ${noun}, median ${roundSig(med)}, range ${roundSig(sorted[0])}–${roundSig(sorted[sorted.length - 1])})`;
  });
  const more = rows.length - shown.length;
  const summaryText = more > 0 ? `${summaries.join("; ")} … and ${more} more` : summaries.join("; ");

  return `Sketch: ${pairs.length} points (categorical x numeric).\n${numericName} by ${categoricalName}: ${summaryText}.`;
};
