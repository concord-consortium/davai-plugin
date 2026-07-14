jest.mock("./tools/get-stats", () => {
  const actual = jest.requireActual("./tools/get-stats");
  return { ...actual, coerceNumericValues: jest.fn(actual.coerceNumericValues) };
});
import { coerceNumericValues } from "./tools/get-stats";
import { computeGraphSketch, isNumericAxis, roundSig } from "./graph-sketch";

describe("roundSig (3 significant figures, plain decimal, no exponential notation)", () => {
  it.each([
    [0.1, "0.1"], [6.5, "6.5"], [0.8, "0.8"], [1.85, "1.85"], [0.01, "0.01"],
    [6277.8, "6280"], [415.58, "416"], [3003.7, "3000"],
    [811.7598816718566, "812"], [-726.8757576652749, "-727"],
    [0.8871962819172852, "0.887"], [400, "400"], [0, "0"], [-0.02, "-0.02"],
  ])("rounds %p to %p", (input, expected) => {
    expect(roundSig(input)).toBe(expected);
  });
});

// Fewer than 2 numeric points must fail soft to "" (never throw), regardless of why the count
// is low — empty input, one point, or numeric contamination reducing the effective count below 2.
describe("fail-soft on insufficient data", () => {
  it("returns '' for zero points", () => {
    expect(computeGraphSketch({ xName: "Height", xValues: [] })).toBe("");
  });

  it("returns '' for exactly one numeric point (univariate)", () => {
    expect(computeGraphSketch({ xName: "Height", xValues: [5] })).toBe("");
  });

  // The >80%-of-non-empty-values axis-type rule is unconditional on sample size: here there are
  // exactly 2 non-empty values ("5", "n/a"), only 1 coerces (50% <= 80%), so the axis is
  // correctly classified CATEGORICAL and describes its actual 2 categories rather than going
  // silent. Verified independently that no N<=5 sample can ever land strictly between 80% and
  // 100% (the smallest fraction exceeding 0.8 needs a denominator of at least 6), so for any axis
  // this small, "categorical" here specifically means "well under 100% numeric", never a marginal
  // call.
  it("reclassifies as a 2-category CATEGORICAL sketch (not '') when non-numeric contamination " +
    "leaves an axis with only 1 of 2 non-empty values numeric — 50% is well under the 80% " +
    "threshold, so this is an unambiguous categorical call, not the old numeric fail-soft", () => {
    const sketch = computeGraphSketch({ xName: "Height", xValues: ["5", "n/a", "", null] });
    expect(sketch).toBe("Height: 5 (1), n/a (1).");
    expect(coerceNumericValues).toHaveBeenCalled();
  });

  // yValues uses null (excluded from the axis-type ratio entirely — "empty strings excluded...
  // simplest: exclude and let counts reflect non-empty") rather than "n/a" (a non-empty value that
  // WOULD count against the ratio) so Mass's one non-empty value (10) stays 100% numeric — this
  // keeps the test on the intended numeric x numeric scatter path (both axes classify numeric)
  // with too few valid PAIRS, rather than sliding into the categorical x numeric path exercised
  // separately just below.
  it("returns '' for a numeric x numeric scatter with fewer than 2 numeric PAIRS (one axis " +
    "short-circuits on missing values, even though both axes independently classify numeric)", () => {
    expect(computeGraphSketch({
      xName: "Height", yName: "Mass", xValues: [1, 2, 3, 4, 5, 6], yValues: [10, null, null, null, null, null],
    })).toBe("");
  });

  // "n/a" is a non-empty, non-coercing value, so it counts against Mass's ratio — with only 2
  // non-empty Mass values and 1 coercing (50% <= 80%), Mass is correctly classified CATEGORICAL,
  // and there are 2 valid (Height, Mass)-category pairs, producing a real categorical x numeric
  // summary.
  it("reclassifies as a categorical x numeric sketch (not '') when the second axis's non-empty " +
    "values are mostly non-numeric junk rather than missing", () => {
    const sketch = computeGraphSketch({
      xName: "Height", yName: "Mass", xValues: [1, 2, 3], yValues: [10, "n/a"],
    });
    expect(sketch).toBe(
      "Sketch: 2 points (categorical x numeric).\nHeight by Mass: 10 (1 case, median 1, range 1–1); n/a (1 case, median 2, range 2–2)."
    );
  });
});

describe("univariate sketch (single axis, no y values)", () => {
  // n=8, sorted [0.1, 0.7, 0.9, 1.1, 1.3, 1.5, 2.2, 6.5]; Tukey hinges Q1=0.8, Q3=1.85;
  // IQR=1.05, fences [-0.775, 3.425] -> only 6.5 is outside (far above).
  const xValues = [0.7, 0.1, 1.5, 1.1, 6.5, 0.9, 2.2, 1.3];

  it("reports point count, range, and the Q1-Q3 'most between' band", () => {
    const sketch = computeGraphSketch({ xName: "Height", xValues });
    expect(sketch).toContain("Sketch: 8 points. Height 0.1–6.5 (most between 0.8 and 1.85).");
  });

  it("appends an IQR outliers line, largest deviation first, capped at 3", () => {
    const sketch = computeGraphSketch({ xName: "Height", xValues });
    expect(sketch).toContain("Outliers: 6.5 (far above the rest).");
  });

  it("omits the outliers line entirely when none exist", () => {
    const noOutliers = [1.0, 1.2, 1.4, 1.6, 1.8, 2.0, 2.2, 2.4];
    const sketch = computeGraphSketch({ xName: "Height", xValues: noOutliers });
    expect(sketch).not.toMatch(/Outliers:/);
  });

  it("caps outliers at 3, largest |deviation from median| first", () => {
    // Tight core of 7 points around 6 (Q1=5, median=6, Q3=7, IQR=2, fences [2, 10]) plus 4 real
    // outliers of increasing extremity: 200, -100, 60, -40 (all verified outside the fences).
    // Expect the 3 most extreme kept in that order; -40 (4th-largest deviation) dropped.
    const xValues2 = [5, 6, 7, 5, 6, 7, 6, 200, -100, 60, -40];
    const sketch = computeGraphSketch({ xName: "V", xValues: xValues2 });
    const line = sketch.split("\n").find((l: string) => l.startsWith("Outliers:"))!;
    expect(line).toBeDefined();
    expect(line.indexOf("200")).toBeLessThan(line.indexOf("-100"));
    expect(line.indexOf("-100")).toBeLessThan(line.indexOf("60"));
    expect(line).not.toContain("-40");
  });

  it("labels a below-median outlier as 'far below the rest'", () => {
    const xValues2 = [10, 11, 12, 10, 11, 12, 11, -40];
    const sketch = computeGraphSketch({ xName: "V", xValues: xValues2 });
    expect(sketch).toContain("Outliers: -40 (far below the rest).");
  });

  it("rounds to 3 significant figures throughout", () => {
    const sketch = computeGraphSketch({ xName: "V", xValues: [1.23456, 2.34567, 3.45678, 9999.111] });
    expect(sketch).not.toMatch(/1\.23456|9999\.111/);
  });

  it("coerces numeric strings and drops junk, via the shared get_stats coercion", () => {
    const sketch = computeGraphSketch({ xName: "Height", xValues: ["0.7", "0.1", "n/a", null, "1.5", "1.1", "6.5", "0.9", "2.2", "1.3", ""] });
    expect(sketch).toContain("Sketch: 8 points.");
  });
});

describe("scatter sketch without an LSRL adornment", () => {
  // x=1..8 (no outliers); y has one huge outlier (400) — Q1=11.5, Q3=13.5, fence upper=16.5.
  const xValues = [1, 2, 3, 4, 5, 6, 7, 8];
  const yValues = [10, 12, 11, 13, 12, 14, 13, 400];

  it("reports both axes' ranges and 'most between' bands on one Sketch line", () => {
    const sketch = computeGraphSketch({ xName: "X", yName: "Y", xValues, yValues });
    expect(sketch).toContain("Sketch: 8 points. X 1–8 (most between 2.5 and 6.5); Y 10–400 (most between 11.5 and 13.5).");
  });

  it("reports the Pearson r direction and strength on a Relationship line", () => {
    const sketch = computeGraphSketch({ xName: "X", yName: "Y", xValues, yValues });
    expect(sketch).toContain("Relationship: positive, moderate (r = 0.58).");
  });

  it("falls back to per-axis IQR outliers (not residuals) when no LSRL adornment is present", () => {
    const sketch = computeGraphSketch({ xName: "X", yName: "Y", xValues, yValues });
    expect(sketch).toContain("Unusually high Y: (8, 400).");
    expect(sketch).not.toMatch(/Farthest from the line/);
  });

  it("omits the per-axis-outliers line when neither axis has one", () => {
    const clean = { xName: "X", yName: "Y", xValues: [1, 2, 3, 4, 5], yValues: [10, 20, 30, 40, 50] };
    const sketch = computeGraphSketch(clean);
    expect(sketch).not.toMatch(/Unusually (high|low)/);
  });

  it("pairs each y-outlier with its OWN x (not the first x sharing that y value) when two " +
    "outlier cases happen to share an identical outlier value", () => {
    // (11, 900) and (12, 900): two distinct cases, same y=900 — a naive re-lookup by value
    // (e.g. array.indexOf(900)) would wrongly report x=11 for both. x itself has no outliers.
    const xValues2 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
    const yValues2 = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 900, 900];
    const sketch = computeGraphSketch({ xName: "X", yName: "Y", xValues: xValues2, yValues: yValues2 });
    expect(sketch).toContain("Unusually high Y: (11, 900), (12, 900).");
  });

  // Each axis's outliers must be grouped and labeled by their OWN side — the "Unusually high/low
  // <axis>" word is never taken from just the single largest |deviation| and applied to every
  // listed value on that axis, which would mislabel a smaller-deviation outlier on the other side.
  it("mixed high+low outliers on ONE axis are split into separate 'Unusually high'/'Unusually " +
    "low' clauses, never mislabeling the smaller-deviation side", () => {
    // X: tight core 10-12 plus a high outlier (200) and a low outlier (-100); Y: no outliers, so
    // this isolates the fix to a single axis.
    const xValues2 = [10, 11, 12, 10, 11, 12, 11, 200, -100];
    const yValues2 = [1, 2, 3, 4, 5, 6, 7, 8, 9];
    const sketch = computeGraphSketch({ xName: "X", yName: "Y", xValues: xValues2, yValues: yValues2 });
    expect(sketch).toContain("Unusually high X: (200, 8); Unusually low X: (-100, 9).");
    expect(sketch).not.toMatch(/Unusually (high|low) Y/);
  });

  it("mixed high+low outliers on BOTH axes each get their own high/low clauses, in x-then-y " +
    "order", () => {
    const xValues2 = [-500, 500, 48, 49, 50, 51, 52, 49, 50, 51];
    const yValues2 = [5, 6, 5, 6, 5, 6, 5, 6, -50, 50];
    const sketch = computeGraphSketch({ xName: "X", yName: "Y", xValues: xValues2, yValues: yValues2 });
    expect(sketch).toContain(
      "Unusually high X: (500, 6); Unusually low X: (-500, 5); " +
      "Unusually high Y: (51, 50); Unusually low Y: (50, -50)."
    );
  });
});

describe("scatter sketch with an LSRL adornment (Mammals-like fixture, n=27)", () => {
  // Deliberately constructed: 24 points following a real positive linear trend (Mass ~ 700*Height
  // - 500 + noise), plus 3 controlled residual outliers (2 far above, 1 far below) so cap-3 +
  // above/below labeling both have real cases to exercise. Values below are exactly what
  // produced the pre-computed slope/intercept/r/r2/residuals asserted in this suite.
  const xValues = [
    0.1, 0.346, 0.592, 0.838, 1.085, 1.331, 1.577, 1.823, 2.069, 2.315, 2.562, 2.808, 3.054, 3.3,
    3.546, 3.792, 4.038, 4.285, 4.531, 4.777, 5.023, 5.269, 5.515, 5.762, 6.008, 6.254, 6.5,
  ];
  const yValues = [
    0.01, 0.01, 0.01, 35.29, 263.81, 415.58, 550.86, 776.99, 48.3, 1065.0, 1285.44, 1413.98,
    1588.69, 1800.94, 2021.42, 2109.26, 2293.39, 2514.79, 2725.43, 2853.15, 3003.7, 3245.45,
    3306.09, 3576.42, 5505.6, 6277.8, 4024.75,
  ];
  const adornments = [{ type: "LSRL", slope: 811.7598816718566, intercept: -726.8757576652749, rSquared: 0.8871962819172852 }];

  it("reports the combined per-axis Sketch line for both axes", () => {
    const sketch = computeGraphSketch({ xName: "Height", yName: "Mass", xValues, yValues, adornments });
    expect(sketch).toContain(
      "Sketch: 27 points. Height 0.1–6.5 (most between 1.58 and 5.02); Mass 0.01–6280 (most between 416 and 3000)."
    );
  });

  it("reports the Relationship line computed from Pearson r here (never from the model)", () => {
    const sketch = computeGraphSketch({ xName: "Height", yName: "Mass", xValues, yValues, adornments });
    expect(sketch).toContain("Relationship: positive, strong (r = 0.94).");
  });

  it("reports the LSRL sentence: equation, R² number, and the plain-words R² sentence", () => {
    const sketch = computeGraphSketch({ xName: "Height", yName: "Mass", xValues, yValues, adornments });
    expect(sketch).toContain(
      "LSRL: Mass = 812 × Height − 727; R² = 0.887 — Height explains about 89% of the variation in Mass."
    );
  });

  it("reports residual outliers (not per-axis outliers), largest |residual| first, with " +
    "above/below labeling, capped at 3", () => {
    const sketch = computeGraphSketch({ xName: "Height", yName: "Mass", xValues, yValues, adornments });
    expect(sketch).toContain("Farthest from the line: (6.25, 6280) and (6.01, 5510) far above; (2.07, 48.3) below.");
    expect(sketch).not.toMatch(/Unusually (high|low)/);
  });

  it("uses a positive-intercept LSRL equation format (+ sign) when intercept is non-negative", () => {
    // Small hand-picked positive-intercept fit: y = 2x + 3 exactly (perfect line, r=1, R²=1).
    const sketch = computeGraphSketch({
      xName: "A", yName: "B", xValues: [1, 2, 3, 4, 5], yValues: [5, 7, 9, 11, 13],
      adornments: [{ type: "LSRL", slope: 2, intercept: 3, rSquared: 1 }],
    });
    expect(sketch).toContain("LSRL: B = 2 × A + 3; R² = 1 — A explains about 100% of the variation in B.");
  });

  it("omits the LSRL and Farthest-from-the-line lines when no LSRL adornment is present, even " +
    "with the same point data", () => {
    const sketch = computeGraphSketch({ xName: "Height", yName: "Mass", xValues, yValues });
    expect(sketch).not.toMatch(/LSRL:/);
    expect(sketch).not.toMatch(/Farthest from the line/);
  });
});

describe("relationship strength-word boundaries (r computed from the fixture, not asserted a priori)", () => {
  // xs fixed 1..10; each ys array below was constructed so Pearson r rounds to exactly the
  // named boundary (verified independently before writing this test).
  const xs = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

  it("r rounding to 0.29 -> weak", () => {
    const ys = [8.84, -0.94, 8.88, -2.86, 6.96, -2.82, 10.92, 7.02, 13.9, 5.1];
    const sketch = computeGraphSketch({ xName: "X", yName: "Y", xValues: xs, yValues: ys });
    expect(sketch).toContain("Relationship: positive, weak (r = 0.29).");
  });

  it("r rounding to 0.3 -> moderate (weak/moderate boundary is inclusive at 0.3)", () => {
    const ys = [8.68, -0.88, 8.76, -2.72, 6.92, -2.64, 10.84, 7.04, 13.8, 5.2];
    const sketch = computeGraphSketch({ xName: "X", yName: "Y", xValues: xs, yValues: ys });
    expect(sketch).toContain("Relationship: positive, moderate (r = 0.3).");
  });

  it("r rounding to 0.69 -> moderate", () => {
    const ys = [4.56, 0.66, 5.67, 0.88, 5.89, 1.99, 8.78, 7.55, 11.23, 7.77];
    const sketch = computeGraphSketch({ xName: "X", yName: "Y", xValues: xs, yValues: ys });
    expect(sketch).toContain("Relationship: positive, moderate (r = 0.69).");
  });

  it("r rounding to 0.7 -> strong (moderate/strong boundary is inclusive at 0.7)", () => {
    const ys = [4.48, 0.7, 5.61, 0.96, 5.87, 2.09, 8.74, 7.57, 11.17, 7.83]; // true r = 0.700758...
    const sketch = computeGraphSketch({ xName: "X", yName: "Y", xValues: xs, yValues: ys });
    expect(sketch).toContain("Relationship: positive, strong (r = 0.7).");
  });

  // The strength word is derived from the DISPLAYED r (rounded to 2 sig figs), not the true r —
  // a blind listener hears the word and the number together, and "moderate (r = 0.7)" or "weak
  // (r = 0.3)" is a contradiction to them. These fixtures sit in the gap where true r and displayed
  // r fall on opposite sides of a boundary, so they fail under any true-r-based strength decision.
  it("true r just UNDER 0.7 that displays as 0.7 -> strong (word tracks the displayed value, " +
    "never contradicting the number the listener hears)", () => {
    const ys = [4.48, 0.69, 5.61, 0.95, 5.87, 2.08, 8.74, 7.56, 11.18, 7.82]; // true r = 0.699960...
    const sketch = computeGraphSketch({ xName: "X", yName: "Y", xValues: xs, yValues: ys });
    expect(sketch).toContain("Relationship: positive, strong (r = 0.7).");
  });

  it("true r just UNDER 0.3 that displays as 0.3 -> moderate (same coherence rule at the " +
    "weak/moderate boundary)", () => {
    const ys = [8.72, -0.9, 8.79, -2.76, 6.93, -2.69, 10.86, 7.03, 13.83, 5.17]; // true r = 0.297445...
    const sketch = computeGraphSketch({ xName: "X", yName: "Y", xValues: xs, yValues: ys });
    expect(sketch).toContain("Relationship: positive, moderate (r = 0.3).");
  });

  it("negative true r just under -0.7 magnitude that displays as -0.7 -> negative, strong " +
    "(strength uses the absolute displayed value; direction word unchanged)", () => {
    const ys = [-4.48, -0.69, -5.61, -0.95, -5.87, -2.08, -8.74, -7.56, -11.18, -7.82]; // true r = -0.699960...
    const sketch = computeGraphSketch({ xName: "X", yName: "Y", xValues: xs, yValues: ys });
    expect(sketch).toContain("Relationship: negative, strong (r = -0.7).");
  });
});

it("reports a negative direction word for negative r", () => {
  const sketch = computeGraphSketch({
    xName: "X", yName: "Y", xValues: [1, 2, 3, 4, 5, 6, 7, 8], yValues: [80, 70, 65, 50, 45, 30, 20, 5],
  });
  expect(sketch).toContain("Relationship: negative, strong (r = -0.99).");
});

// pearsonR's denominator (product of the two axes' standard deviations) is 0 whenever EITHER
// axis is constant, producing NaN. An undefined correlation is a real fact, not a defect, so
// state it plainly and skip the entire r-dependent remainder (LSRL/R², per-axis outliers) rather
// than printing any NaN-derived text.
describe("zero-variance axis: an undefined correlation is stated plainly, never as NaN", () => {
  it("constant X axis: names X as the constant axis, with no r/NaN/R² mention anywhere", () => {
    const sketch = computeGraphSketch({
      xName: "Height", yName: "Mass", xValues: [5, 5, 5, 5, 5], yValues: [1, 2, 3, 4, 10],
    });
    expect(sketch).toContain("Relationship: undefined — every point has the same Height.");
    expect(sketch).not.toMatch(/NaN/);
    expect(sketch).not.toMatch(/r = /);
    expect(sketch).not.toMatch(/R²/);
  });

  it("constant Y axis: names Y as the constant axis", () => {
    const sketch = computeGraphSketch({
      xName: "Height", yName: "Mass", xValues: [1, 2, 3, 4, 10], yValues: [7, 7, 7, 7, 7],
    });
    expect(sketch).toContain("Relationship: undefined — every point has the same Mass.");
    expect(sketch).not.toMatch(/NaN/);
  });

  it("both axes constant: names both", () => {
    const sketch = computeGraphSketch({
      xName: "Height", yName: "Mass", xValues: [5, 5, 5], yValues: [7, 7, 7],
    });
    expect(sketch).toContain("Relationship: undefined — every point has the same Height and Mass.");
  });

  it("suppresses the LSRL/R² line entirely even when an LSRL adornment is present on a " +
    "constant axis — never derives a line/R² from a vertical or horizontal scatter", () => {
    const sketch = computeGraphSketch({
      xName: "Height", yName: "Mass", xValues: [5, 5, 5, 5, 5], yValues: [1, 2, 3, 4, 10],
      adornments: [{ type: "LSRL", slope: 0, intercept: 5, rSquared: 0 }],
    });
    expect(sketch).not.toMatch(/LSRL:/);
    expect(sketch).not.toMatch(/R²/);
  });

  it("still reports the Selected line for a constant-axis scatter (orthogonal to the undefined " +
    "correlation)", () => {
    const sketch = computeGraphSketch({
      xName: "Height", yName: "Mass", xValues: [5, 5, 5, 5, 5], yValues: [1, 2, 3, 4, 10],
      selectedPairs: [[5, 2]],
    });
    expect(sketch).toContain("Selected: 1 case at (5, 2).");
  });
});

// r === 0 exactly is a real, valid "no linear relationship" result (NOT the zero-variance/NaN
// case above) — "positive"/"negative" would assert a direction that does not exist for an
// exactly-uncorrelated pair.
describe("r = 0 exactly: 'no linear relationship' wording, not a false direction", () => {
  it("reads 'no linear relationship (r = 0)' instead of 'positive, weak (r = 0)'", () => {
    // y = (x-3)^2, symmetric about x=3 -> cov(x,y) sums to exactly 0 (integer arithmetic, no
    // floating-point risk) while both axes still have real variance (not the zero-variance case).
    const xValues = [1, 2, 3, 4, 5];
    const yValues = [4, 1, 0, 1, 4];
    const sketch = computeGraphSketch({ xName: "X", yName: "Y", xValues, yValues });
    expect(sketch).toContain("Relationship: no linear relationship (r = 0).");
    expect(sketch).not.toMatch(/positive|negative/);
  });
});

// A floating-point artifact (or a malformed but present rSquared from CODAP's own adornment
// data) slightly over 1 must never be spoken as "explains about 101%+ of the variation" — R²
// cannot exceed 1 by definition.
describe("R² clamp: displayed R² never exceeds 100%", () => {
  it("clamps a >1 rSquared (a floating-point artifact large enough to survive rounding, e.g. " +
    "from CODAP's own adornment data) to 1 / 100%, never a nonsensical >100%", () => {
    const sketch = computeGraphSketch({
      xName: "A", yName: "B", xValues: [1, 2, 3, 4, 5], yValues: [5, 7, 9, 11, 13],
      adornments: [{ type: "LSRL", slope: 2, intercept: 3, rSquared: 1.02 }],
    });
    expect(sketch).toContain("R² = 1");
    expect(sketch).toContain("100% of the variation");
    expect(sketch).not.toMatch(/10[1-9]%|1[1-9]\d%/);
  });
});

// findLSRL type-checks slope/intercept AND rSquared's shape (all must be numbers) before
// accepting an adornment as a usable LSRL — a malformed rSquared (e.g. array-shaped, from a
// hypothetical legend-split multi-line representation) degrades gracefully to the per-axis-
// outliers branch instead of the LSRL/R² line embedding that malformed value directly (e.g.
// "explains about NaN% of the variation"). A numeric rSquared, or one simply absent and computed
// from r via the existing `?? r * r` fallback, is unaffected.
describe("LSRL graceful degrade: a malformed rSquared shape is treated as no-LSRL, never " +
  "printing undefined/NaN", () => {
  const xValues = [1, 2, 3, 4, 5, 6, 7, 8];
  const yValues = [10, 12, 11, 13, 12, 14, 13, 400];

  it("an array-shaped rSquared degrades to the per-axis-outliers branch instead of a broken LSRL/R² line", () => {
    const sketch = computeGraphSketch({
      xName: "X", yName: "Y", xValues, yValues,
      adornments: [{ type: "LSRL", slope: 1, intercept: 5, rSquared: [0.887] as any }],
    });
    expect(sketch).not.toMatch(/LSRL:/);
    expect(sketch).not.toMatch(/undefined/);
    expect(sketch).not.toMatch(/NaN/);
    expect(sketch).toContain("Unusually high Y: (8, 400)."); // the graceful-degrade path
  });

  it("a genuinely MISSING rSquared is unchanged — still computes R² from r (the verified, " +
    "already-working shape)", () => {
    const sketch = computeGraphSketch({
      xName: "Height", yName: "Mass", xValues: [1, 2, 3, 4, 5], yValues: [5, 7, 9, 11, 13],
      adornments: [{ type: "LSRL", slope: 2, intercept: 3 }], // no rSquared at all
    });
    expect(sketch).toContain("R² = 1"); // r = 1 exactly for this fixture -> r*r fallback = 1
    expect(sketch).not.toMatch(/undefined/);
  });
});

// `typeof x === "number"` is TRUE for NaN (typeof NaN === "number"), so a plain typeof check
// alone would accept a NaN slope/intercept as a usable LSRL adornment — findLSRL instead requires
// slope AND intercept to be Number.isFinite, rejecting the whole adornment when either isn't
// (same graceful degrade the array-shaped-rSquared case above gets). A present-but-non-finite
// rSquared does not reject the adornment outright (slope/intercept alone decide eligibility): NaN
// is not null/undefined, so the `?? r * r` fallback never substitutes it, but it only suppresses
// the R²-dependent sentence at render time, leaving the equation line intact.
describe("NaN slope/intercept/rSquared never leak into the LSRL sketch", () => {
  const xValues = [1, 2, 3, 4, 5, 6, 7, 8];
  const yValues = [10, 12, 11, 13, 12, 14, 13, 400];

  it("a NaN rSquared omits only the R² sentence — the equation line still stands since " +
    "slope/intercept are both finite", () => {
    const sketch = computeGraphSketch({
      xName: "X", yName: "Y", xValues, yValues,
      adornments: [{ type: "LSRL", slope: 1, intercept: 5, rSquared: NaN }],
    });
    expect(sketch).toContain("LSRL: Y = 1 × X + 5.");
    expect(sketch).not.toMatch(/R²/);
    expect(sketch).not.toMatch(/NaN/);
  });

  it("a NaN slope rejects the whole LSRL adornment, falling back to the per-axis-outliers branch", () => {
    const sketch = computeGraphSketch({
      xName: "X", yName: "Y", xValues, yValues,
      adornments: [{ type: "LSRL", slope: NaN, intercept: 5, rSquared: 0.9 }],
    });
    expect(sketch).not.toMatch(/LSRL:/);
    expect(sketch).not.toMatch(/NaN/);
    expect(sketch).toContain("Unusually high Y: (8, 400).");
  });

  it("a NaN intercept also rejects the whole LSRL adornment (same as a NaN slope)", () => {
    const sketch = computeGraphSketch({
      xName: "X", yName: "Y", xValues, yValues,
      adornments: [{ type: "LSRL", slope: 1, intercept: NaN, rSquared: 0.9 }],
    });
    expect(sketch).not.toMatch(/LSRL:/);
    expect(sketch).not.toMatch(/NaN/);
  });
});

describe("selected pairs line", () => {
  const base = { xName: "Height", yName: "Mass", xValues: [1, 2, 3, 4, 5, 6, 7, 8], yValues: [10, 20, 30, 40, 50, 60, 70, 80] };

  it("omits the Selected line when no pairs are provided", () => {
    expect(computeGraphSketch(base)).not.toMatch(/Selected:/);
  });

  it("omits the Selected line when selectedPairs is an empty array", () => {
    expect(computeGraphSketch({ ...base, selectedPairs: [] })).not.toMatch(/Selected:/);
  });

  it("reports a single selected case", () => {
    const sketch = computeGraphSketch({ ...base, selectedPairs: [[5, 1100]] });
    expect(sketch).toContain("Selected: 1 case at (5, 1100).");
  });

  it("caps at 3 coordinates then adds '… and N more'", () => {
    const sketch = computeGraphSketch({
      ...base, selectedPairs: [[1, 10], [2, 20], [3, 30], [4, 40]],
    });
    expect(sketch).toContain("Selected: 4 cases at (1, 10), (2, 20), (3, 30) … and 1 more.");
  });

  // A non-numeric coordinate in a pair is silently skipped from the listed coordinates, and the
  // "N cases" count must adjust to match what's actually listed — never selectedPairs.length (the
  // original, pre-filter count).
  it("skips a non-numeric pair and reports the count of SURVIVING numeric pairs, never a " +
    "miscount", () => {
    const sketch = computeGraphSketch({
      ...base, selectedPairs: [[5, 1100], ["junk", "also junk"], [6, 1200]],
    });
    expect(sketch).toContain("Selected: 2 cases at (5, 1100), (6, 1200).");
  });

  // When EVERY selected pair is non-numeric, the coordinate list is empty, so the Selected line
  // must be omitted entirely — never "Selected: N cases at .", an empty, nonsensical clause.
  it("omits the Selected line entirely when every pair is non-numeric — never 'Selected: N " +
    "cases at .'", () => {
    const sketch = computeGraphSketch({ ...base, selectedPairs: [["junk", "also junk"]] });
    expect(sketch).not.toMatch(/Selected:/);
    expect(sketch).not.toMatch(/at \./);
  });
});

describe("units (fail-soft, only when supplied)", () => {
  it("includes the unit in the univariate Sketch line when xUnit is provided", () => {
    const sketch = computeGraphSketch({
      xName: "Height", xValues: [0.7, 0.1, 1.5, 1.1, 6.5, 0.9, 2.2, 1.3], xUnit: "meters",
    });
    expect(sketch).toContain("Sketch: 8 points. Height (meters) 0.1–6.5 (most between 0.8 and 1.85).");
  });

  it("omits the unit parenthetical entirely when xUnit/yUnit are not provided (today's default)", () => {
    const sketch = computeGraphSketch({ xName: "Height", xValues: [0.7, 0.1, 1.5, 1.1, 6.5, 0.9, 2.2, 1.3] });
    expect(sketch).not.toContain("(meters)");
    expect(sketch).toMatch(/^Sketch: 8 points\. Height 0\.1–6\.5/);
  });
});

// A graph with two categorical axes must not produce an empty sketch — computeGraphSketch has to
// detect each axis's type and, when categorical, hand over the REAL category counts and crosstab
// so describing the graph becomes transcription, not invention (the same principle already
// applied for numeric axes). Otherwise get_graph_info hands over structure only, and the model
// fills the vacuum with invented categories that don't exist in the data.
describe("axis type detection (>80% of non-empty raw values coerce numeric => NUMERIC axis)", () => {
  // 5 numeric-looking + 1 junk = 5/6 = 83.3% > 80% -> numeric. Uses the exact shared coercion
  // (get_stats's coerceNumericValues) — this is a boundary-behavior test, not a duplicate of it.
  it("treats an axis as NUMERIC when just over 80% of its non-empty values coerce", () => {
    const sketch = computeGraphSketch({ xName: "V", xValues: [1, 2, 3, 4, 5, "junk"] });
    // A numeric univariate sketch reports a range; a categorical one would report category counts.
    expect(sketch).toMatch(/Sketch: \d+ points\. V /);
    expect(sketch).not.toMatch(/V:.*\(\d+\)/);
  });

  // 4 numeric-looking + 2 junk = 4/6 = 66.7% <= 80% -> categorical (raw string values used).
  it("treats an axis as CATEGORICAL when at or under 80% of its non-empty values coerce", () => {
    const sketch = computeGraphSketch({ xName: "V", xValues: ["1", "2", "3", "4", "junk1", "junk2"] });
    expect(sketch).toMatch(/^V: /);
    expect(sketch).toContain('"junk1"'.replace(/"/g, "")); // categories render as raw strings
  });

  // Numeric-STRING axis: every value is a numeric string ("1","2",...) — 100% coerce, so it must
  // stay numeric (categorical mode must not accidentally swallow purely-numeric-as-string axes).
  it("keeps a numeric-strings axis (\"1\",\"2\",...) NUMERIC, not categorical", () => {
    const sketch = computeGraphSketch({ xName: "V", xValues: ["1", "2", "3", "4", "5", "6", "7", "8"] });
    expect(sketch).toMatch(/Sketch: 8 points\. V 1–8/);
  });

  // Mixed junk that still clears 80%: empty strings are excluded from the denominator per the
  // brief ("exclude and let counts reflect non-empty"), so this axis is 6 non-empty values, all
  // numeric -> 100% -> numeric, not miscounted as 6/9 = 66.7%.
  it("excludes empty strings from the non-empty denominator when computing the numeric ratio", () => {
    const sketch = computeGraphSketch({ xName: "V", xValues: [1, 2, 3, 4, 5, 6, "", "", ""] });
    expect(sketch).toMatch(/Sketch: 6 points\. V 1–6/);
  });

  // Exactly-80% boundary is NOT numeric ("> 80%", strictly greater-than).
  it("treats exactly 80% coercing as CATEGORICAL (the threshold is a strict >80%, not >=)", () => {
    // 4 numeric + 1 junk = 4/5 = 80% exactly.
    const sketch = computeGraphSketch({ xName: "V", xValues: ["1", "2", "3", "4", "junk"] });
    expect(sketch).toMatch(/^V: /);
  });

  // The shared coerceNumericValues treats a whitespace-only string as numeric zero
  // (Number("   ") === 0 is finite) — a known, separately-tracked quirk of the reused coercion,
  // not something this test modifies. Left untrimmed, that quirk alone could tip an obviously-
  // categorical, mostly-blank axis (a common data-entry artifact: someone left the cell as spaces
  // instead of truly empty) over the 80% line into "numeric", producing a nonsense "range 0-0"
  // sketch. This axis (9 whitespace-only + 2 real category words = 11 non-empty values) is 0/11 =
  // 0% coercing if whitespace-only values are correctly excluded as empty, or 9/11 = 81.8% (> 80%,
  // wrongly numeric) if they are not trimmed first. The threshold's own emptiness check trims
  // strings before comparing to "", so this axis correctly reports as CATEGORICAL either way in
  // practice.
  it("is robust to M-k's whitespace quirk: whitespace-only strings are trimmed before the " +
    "emptiness check, so they never masquerade as numeric zeros in the axis-type ratio", () => {
    const nineWhitespacePlusTwoReal = [
      "   ", "   ", "   ", "   ", "   ", "   ", "   ", "   ", "   ", "meat", "plants",
    ];
    expect(isNumericAxis(nineWhitespacePlusTwoReal)).toBe(false);
    const sketch = computeGraphSketch({ xName: "Diet", xValues: nineWhitespacePlusTwoReal });
    expect(sketch).toBe("Diet: meat (1), plants (1).");
    expect(sketch).not.toMatch(/0–0|range 0/);
  });
});

describe("categorical x categorical sketch (Mammals Diet x Habitat fixture, n=27)", () => {
  // Fixture: Diet meat/both/plants, Habitat land/water/both. Crosstab reconciled against the
  // stated marginals (Diet meat=11/both=9/plants=7; Habitat land=24/water=2/both=1):
  // meat&land=8, both&land=9, plants&land=7, meat&water=2, meat&both=1 (all other cells 0) — the
  // only cell assignment whose row AND column sums both match every stated marginal exactly
  // (verified independently).
  const dietValues = [
    ...Array(8).fill("meat"), ...Array(2).fill("meat"), ...Array(1).fill("meat"), // 11 meat
    ...Array(9).fill("both"), // 9 both
    ...Array(7).fill("plants"), // 7 plants
  ];
  const habitatValues = [
    ...Array(8).fill("land"), ...Array(2).fill("water"), ...Array(1).fill("both"), // meat rows
    ...Array(9).fill("land"), // both rows
    ...Array(7).fill("land"), // plants rows
  ];

  it("matches the live-report fixture's exact category and crosstab counts", () => {
    // Sanity-check the fixture itself before asserting on the sketch derived from it.
    expect(dietValues).toHaveLength(27);
    expect(dietValues.filter((d) => d === "meat")).toHaveLength(11);
    expect(dietValues.filter((d) => d === "both")).toHaveLength(9);
    expect(dietValues.filter((d) => d === "plants")).toHaveLength(7);
    expect(habitatValues.filter((h) => h === "land")).toHaveLength(24);
    expect(habitatValues.filter((h) => h === "water")).toHaveLength(2);
    expect(habitatValues.filter((h) => h === "both")).toHaveLength(1);
  });

  it("produces the exact sketch text: point count, per-axis category counts (descending), and " +
    "the largest crosstab combinations (descending) — the regression test for the hallucination " +
    "report (real category names only, never invented ones)", () => {
    const sketch = computeGraphSketch({
      xName: "Diet", yName: "Habitat", xValues: dietValues, yValues: habitatValues,
    });
    expect(sketch).toBe(
      "Sketch: 27 points (two categorical attributes).\n" +
      "Diet (x): meat (11), both (9), plants (7). Habitat (y): land (24), water (2), both (1).\n" +
      "Largest combinations: both & land (9), meat & land (8), plants & land (7), meat & water (2), meat & both (1).\n" +
      "Empty combinations: both & water, both & both, plants & water, plants & both."
    );
  });

  it("never invents category names absent from the data (the exact hallucination this task fixes)", () => {
    const sketch = computeGraphSketch({
      xName: "Diet", yName: "Habitat", xValues: dietValues, yValues: habitatValues,
    });
    expect(sketch).not.toMatch(/herbivore|carnivore|omnivore|forest|grassland|aquatic/i);
  });

  it("caps an axis at 8 categories with '… and N more' when there are 9 or more distinct values", () => {
    const nineCats = Array.from({ length: 9 }, (_, i) => `cat${i}`);
    // 3 cases per category so every axis has enough points to be unambiguously categorical (raw,
    // non-numeric strings) and each category is non-degenerate.
    const xValues = nineCats.flatMap((c) => [c, c, c]);
    const yValues = xValues.map(() => "same"); // single-category y keeps focus on the x-axis cap
    const sketch = computeGraphSketch({ xName: "Cat", yName: "Y", xValues, yValues });
    const axisLine = sketch.split("\n")[1];
    expect(axisLine).toContain("cat0 (3), cat1 (3), cat2 (3), cat3 (3), cat4 (3), cat5 (3), cat6 (3), cat7 (3)");
    expect(axisLine).toContain("… and 1 more");
    expect(axisLine).not.toContain("cat8");
  });

  it("caps 'Largest combinations' at 6 with '… and N more combinations' when more than 6 " +
    "nonzero cells exist, and omits the Empty combinations line once more than 4 cells are empty " +
    "(a 4x4 grid has 16 cells; filling only the diagonal-plus-one leaves >4 empty)", () => {
    // 4x4 grid, 7 nonzero cells (diagonal x1..x4/y1..y4 plus x1&y2, x1&y3, x1&y4) with distinct
    // descending counts so cap-6 ordering is unambiguous; the remaining 9 cells are empty (>4).
    const xValues: string[] = [];
    const yValues: string[] = [];
    const push = (x: string, y: string, n: number) => {
      for (let i = 0; i < n; i++) { xValues.push(x); yValues.push(y); }
    };
    push("x1", "y1", 10); push("x1", "y2", 9); push("x1", "y3", 8); push("x1", "y4", 7);
    push("x2", "y2", 6); push("x3", "y3", 5); push("x4", "y4", 4);
    const sketch = computeGraphSketch({ xName: "X", yName: "Y", xValues, yValues });
    const lines = sketch.split("\n");
    const combosLine = lines.find((l) => l.startsWith("Largest combinations:"))!;
    expect(combosLine).toBe(
      "Largest combinations: x1 & y1 (10), x1 & y2 (9), x1 & y3 (8), x1 & y4 (7), x2 & y2 (6), " +
      "x3 & y3 (5) … and 1 more combinations."
    );
    expect(lines.find((l) => l.startsWith("Empty combinations:"))).toBeUndefined();
  });

  it("omits the Empty combinations line entirely when there are zero empty cells (every " +
    "combination of categories is populated)", () => {
    // 2x2 full grid: all 4 cells nonzero.
    const xValues = ["a", "a", "b", "b"];
    const yValues = ["p", "q", "p", "q"];
    const sketch = computeGraphSketch({ xName: "X", yName: "Y", xValues, yValues });
    expect(sketch).not.toMatch(/Empty combinations:/);
  });

  // Regression guard: the crosstab's internal cell-key encoding must not assume category names
  // are single words. Category values are free-form user text (e.g. "red fox", "open field") —
  // an implementation that joins x/y into one delimited string and splits it back apart would
  // silently misattribute words to the wrong axis for any multi-word category name.
  it("keeps multi-word category names intact in both the axis summaries and the combinations " +
    "line (the crosstab's internal cell key must not assume single-word categories)", () => {
    const xValues = ["red fox", "red fox", "gray wolf", "gray wolf"];
    const yValues = ["forest edge", "forest edge", "open field", "open field"];
    const sketch = computeGraphSketch({ xName: "Species", yName: "Habitat", xValues, yValues });
    expect(sketch).toBe(
      "Sketch: 4 points (two categorical attributes).\n" +
      "Species (x): red fox (2), gray wolf (2). Habitat (y): forest edge (2), open field (2).\n" +
      "Largest combinations: red fox & forest edge (2), gray wolf & open field (2).\n" +
      "Empty combinations: red fox & open field, gray wolf & forest edge."
    );
  });
});

describe("categorical x numeric sketch (per-category median + range)", () => {
  // Diet (categorical, x) vs a numeric attribute (Height, y): meat/both/plants groups from the
  // live-report fixture, each given distinct numeric values so medians/ranges are unambiguous.
  const dietValues = [...Array(11).fill("meat"), ...Array(9).fill("both"), ...Array(7).fill("plants")];
  // meat: 11 values 0.1..6.5 evenly spaced-ish (median = 6th of 11 sorted); both: 9 values;
  // plants: 7 values. Hand-picked so median/min/max are simple to verify independently.
  const heightValues = [
    ...[0.1, 0.5, 0.8, 1.0, 1.1, 1.2, 1.3, 1.6, 2.0, 3.0, 6.5], // meat: sorted median = 1.2
    ...[0.4, 0.6, 0.9, 1.0, 1.1, 1.4, 1.8, 2.2, 2.5], // both: sorted median = 1.1
    ...[0.7, 0.9, 1.0, 1.2, 1.5, 1.9, 2.1], // plants: sorted median = 1.2
  ];

  it("reports a per-category median + range line, categories by descending count, capped at 6", () => {
    const sketch = computeGraphSketch({
      xName: "Diet", yName: "Height", xValues: dietValues, yValues: heightValues,
    });
    expect(sketch).toBe(
      "Sketch: 27 points (categorical x numeric).\n" +
      "Height by Diet: meat (11 cases, median 1.2, range 0.1–6.5); both (9 cases, median 1.1, range 0.4–2.5); " +
      "plants (7 cases, median 1.2, range 0.7–2.1)."
    );
  });

  it("produces the same per-category summary regardless of which axis (x or y) is categorical " +
    "(orientation-independent)", () => {
    // Flip: Height is x (numeric), Diet is y (categorical) — same underlying data.
    const sketch = computeGraphSketch({
      xName: "Height", yName: "Diet", xValues: heightValues, yValues: dietValues,
    });
    expect(sketch).toContain(
      "Height by Diet: meat (11 cases, median 1.2, range 0.1–6.5); both (9 cases, median 1.1, range 0.4–2.5); " +
      "plants (7 cases, median 1.2, range 0.7–2.1)."
    );
  });

  it("caps per-category summaries at 6 categories, largest count first", () => {
    const cats = Array.from({ length: 7 }, (_, i) => `cat${i}`);
    const xValues = cats.flatMap((c, idx) => Array(7 - idx).fill(c)); // counts 7,6,5,4,3,2,1
    const yValues = xValues.map((_, i) => i + 1);
    const sketch = computeGraphSketch({ xName: "Cat", yName: "Num", xValues, yValues });
    const line = sketch.split("\n")[1];
    expect(line).toContain("cat0 (7 cases");
    expect(line).toContain("cat5 (2 cases");
    expect(line).not.toContain("cat6");
  });
});

describe("univariate categorical sketch (x only, no y)", () => {
  it("reports category counts, descending, with the same cap-8 rule", () => {
    const dietValues = [...Array(11).fill("meat"), ...Array(9).fill("both"), ...Array(7).fill("plants")];
    const sketch = computeGraphSketch({ xName: "Diet", xValues: dietValues });
    expect(sketch).toBe("Diet: meat (11), both (9), plants (7).");
  });

  it("caps at 8 categories with '… and N more'", () => {
    const nineCats = Array.from({ length: 9 }, (_, i) => `cat${i}`);
    const xValues = nineCats.flatMap((c) => [c, c]);
    const sketch = computeGraphSketch({ xName: "Cat", xValues });
    expect(sketch).toBe(
      "Cat: cat0 (2), cat1 (2), cat2 (2), cat3 (2), cat4 (2), cat5 (2), cat6 (2), cat7 (2) … and 1 more."
    );
  });

  // Fewer than 2 non-empty values must still fail soft to "" — categorical mode does not get a
  // lower bar than numeric mode's existing "" contract.
  it("still fails soft to '' when there are fewer than 2 non-empty categorical values", () => {
    expect(computeGraphSketch({ xName: "Diet", xValues: ["meat"] })).toBe("");
    expect(computeGraphSketch({ xName: "Diet", xValues: [] })).toBe("");
  });
});

describe("pure-numeric regression guard (byte-identical to Task B, never touched by Task H)", () => {
  // Re-asserts the exact strings from the pre-existing suites above so a regression in the new
  // axis-type branch cannot silently change numeric output — this is the literal
  // "byte-identical" contract, pinned as its own explicit guard.
  it("univariate numeric sketch text is unchanged", () => {
    const xValues = [0.7, 0.1, 1.5, 1.1, 6.5, 0.9, 2.2, 1.3];
    expect(computeGraphSketch({ xName: "Height", xValues })).toBe(
      "Sketch: 8 points. Height 0.1–6.5 (most between 0.8 and 1.85).\nOutliers: 6.5 (far above the rest)."
    );
  });

  it("scatter (numeric x numeric) sketch text is unchanged", () => {
    const xValues = [1, 2, 3, 4, 5, 6, 7, 8];
    const yValues = [10, 12, 11, 13, 12, 14, 13, 400];
    const sketch = computeGraphSketch({ xName: "X", yName: "Y", xValues, yValues });
    expect(sketch).toBe(
      "Sketch: 8 points. X 1–8 (most between 2.5 and 6.5); Y 10–400 (most between 11.5 and 13.5).\n" +
      "Relationship: positive, moderate (r = 0.58).\n" +
      "Unusually high Y: (8, 400)."
    );
  });
});
