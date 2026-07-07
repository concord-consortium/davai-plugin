import { coerceNumericValues } from "./tools/get-stats";

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

// Round to N significant figures, formatted as a plain (non-exponential) decimal string, with
// trailing zeros after the decimal point trimmed. `toPrecision`/`toExponential` alone would
// render values like 6277.8 as "6.28e+3", which reads badly in prose — this never does that.
export const roundSig = (n: number, sig = 3): string => {
  if (n === 0) return "0";
  const negative = n < 0;
  const abs = Math.abs(n);
  const magnitude = Math.floor(Math.log10(abs));
  // The exponent can be negative (magnitude >= sig, e.g. 6277.8 at 3 sig figs needs rounding to
  // the nearest 10 — a NEGATIVE decimal-places count, which toFixed cannot express directly), so
  // round via a scale/round/unscale on the unclamped exponent, and clamp only for the final
  // toFixed call (which needs a non-negative digit count to format the result as plain decimal).
  const roundingExponent = sig - 1 - magnitude;
  const scale = Math.pow(10, roundingExponent);
  const rounded = Math.round(abs * scale) / scale;
  const decimals = Math.max(0, roundingExponent);
  let s = rounded.toFixed(decimals);
  if (s.includes(".")) s = s.replace(/0+$/, "").replace(/\.$/, "");
  return (negative ? "-" : "") + s;
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
// moderate side at both 0.3 and 0.7).
const strengthWord = (r: number): string => {
  const abs = Math.abs(r);
  if (abs < 0.3) return "weak";
  if (abs < 0.7) return "moderate";
  return "strong";
};

const directionWord = (r: number): string => (r < 0 ? "negative" : "positive");

const findLSRL = (adornments: IGraphAdornmentInput[] | undefined): IGraphAdornmentInput | undefined =>
  adornments?.find((a) => a.type === "LSRL" && typeof a.slope === "number" && typeof a.intercept === "number");

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

export const computeGraphSketch = (input: IGraphSketchInput): string => {
  const xNumbers = coerceNumericValues(input.xValues);
  const hasY = input.yName !== undefined && input.yValues !== undefined;

  if (!hasY) {
    if (xNumbers.length < 2) return "";
    return buildUnivariateSketch(input.xName, input.xUnit, xNumbers);
  }

  // Scatter: only cases numeric on BOTH axes form a valid pair (index-aligned with xValues).
  const yValuesRaw = input.yValues as unknown[];
  const pairs: { x: number; y: number }[] = [];
  input.xValues.forEach((rawX, i) => {
    const [x] = coerceNumericValues([rawX]);
    const [y] = coerceNumericValues([yValuesRaw[i]]);
    if (x !== undefined && y !== undefined) pairs.push({ x, y });
  });
  if (pairs.length < 2) return "";

  return buildScatterSketch(input, pairs);
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

  const r = pearsonR(xs, ys);
  lines.push(`Relationship: ${directionWord(r)}, ${strengthWord(r)} (r = ${roundSig(r, 2)}).`);

  const lsrl = findLSRL(input.adornments);
  if (lsrl) {
    const slope = lsrl.slope as number;
    const intercept = lsrl.intercept as number;
    const interceptClause = intercept < 0 ? `− ${roundSig(Math.abs(intercept))}` : `+ ${roundSig(intercept)}`;
    const rSquared = lsrl.rSquared ?? r * r;
    lines.push(
      `LSRL: ${input.yName} = ${roundSig(slope)} × ${input.xName} ${interceptClause}; R² = ${roundSig(rSquared)} — ` +
        `${input.xName} explains about ${Math.round(rSquared * 100)}% of the variation in ${input.yName}.`
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
    const unusualParts: string[] = [];
    if (xOutliers.length > 0) {
      unusualParts.push(
        `Unusually ${xOutliers[0].aboveMedian ? "high" : "low"} ${input.xName}: ` +
          `${xOutliers.map((o) => formatCoord(o.value, ys[o.index])).join(", ")}`
      );
    }
    if (yOutliers.length > 0) {
      unusualParts.push(
        `Unusually ${yOutliers[0].aboveMedian ? "high" : "low"} ${input.yName}: ` +
          `${yOutliers.map((o) => formatCoord(xs[o.index], o.value)).join(", ")}`
      );
    }
    if (unusualParts.length > 0) lines.push(`${unusualParts.join("; ")}.`);
  }

  if (input.selectedPairs && input.selectedPairs.length > 0) {
    const coords = input.selectedPairs
      .map(([x, y]) => coerceNumericValues([x, y]))
      .filter((c) => c.length === 2)
      .map(([x, y]) => formatCoord(x, y));
    const count = input.selectedPairs.length;
    const noun = count === 1 ? "case" : "cases";
    const shown = coords.slice(0, MAX_SELECTED);
    const more = coords.length - shown.length;
    const coordText = more > 0 ? `${shown.join(", ")} … and ${more} more` : shown.join(", ");
    lines.push(`Selected: ${count} ${noun} at ${coordText}.`);
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
