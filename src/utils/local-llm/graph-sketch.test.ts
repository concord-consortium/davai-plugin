jest.mock("./tools/get-stats", () => {
  const actual = jest.requireActual("./tools/get-stats");
  return { ...actual, coerceNumericValues: jest.fn(actual.coerceNumericValues) };
});
import { coerceNumericValues } from "./tools/get-stats";
import { computeGraphSketch, roundSig } from "./graph-sketch";

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

// DAVAI-126 Task B: fewer than 2 numeric points must fail soft to "" (never throw), regardless
// of why the count is low — empty input, one point, or numeric contamination reducing the
// effective count below 2.
describe("fail-soft on insufficient data", () => {
  it("returns '' for zero points", () => {
    expect(computeGraphSketch({ xName: "Height", xValues: [] })).toBe("");
  });

  it("returns '' for exactly one numeric point (univariate)", () => {
    expect(computeGraphSketch({ xName: "Height", xValues: [5] })).toBe("");
  });

  it("returns '' when non-numeric contamination leaves fewer than 2 numeric values, reusing " +
    "get_stats's own coercion (not a duplicate)", () => {
    expect(computeGraphSketch({ xName: "Height", xValues: ["5", "n/a", "", null] })).toBe("");
    expect(coerceNumericValues).toHaveBeenCalled();
  });

  it("returns '' for a scatter with fewer than 2 numeric PAIRS (one axis short-circuits)", () => {
    expect(computeGraphSketch({
      xName: "Height", yName: "Mass", xValues: [1, 2, 3], yValues: [10, "n/a"],
    })).toBe("");
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
  // named boundary (verified independently before writing this test — see report for method).
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

  it("r rounding to 0.7 -> strong (moderate/strong boundary is inclusive at 0.7; the strength " +
    "decision uses the true r, not the 2dp-rounded display value — this fixture's true r is " +
    "0.700758..., just above the boundary, and still displays as 0.7)", () => {
    const ys = [4.48, 0.7, 5.61, 0.96, 5.87, 2.09, 8.74, 7.57, 11.17, 7.83];
    const sketch = computeGraphSketch({ xName: "X", yName: "Y", xValues: xs, yValues: ys });
    expect(sketch).toContain("Relationship: positive, strong (r = 0.7).");
  });
});

it("reports a negative direction word for negative r", () => {
  const sketch = computeGraphSketch({
    xName: "X", yName: "Y", xValues: [1, 2, 3, 4, 5, 6, 7, 8], yValues: [80, 70, 65, 50, 45, 30, 20, 5],
  });
  expect(sketch).toContain("Relationship: negative, strong (r = -0.99).");
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
