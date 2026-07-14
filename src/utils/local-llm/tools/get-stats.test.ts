jest.mock("../../codap-api-utils", () => ({ getCollectionItemsForAttribute: jest.fn() }));
import { getCollectionItemsForAttribute } from "../../codap-api-utils";
import { getStatsTool, computeStats, coerceNumericValues } from "./get-stats";
import { ILocalToolContext } from "./registry";

const dc = { name: "Mammals", collections: [{ name: "Cases", attrs: [{ name: "Height" }, { name: "Habitat" }] }] };
const ctx = { dataContexts: () => ({ Mammals: dc }) } as unknown as ILocalToolContext;

// graph-sketch.ts reuses this exact coercion (imported, not duplicated) — this test locks its
// contract (numbers pass through, numeric strings coerce, "", null, whitespace-only strings, and
// non-numeric strings are dropped) so both call sites can rely on identical behavior. Booleans
// deliberately STAY coerced to 1/0 (Number(true)=1, Number(false)=0) — a mean over a boolean
// attribute is a real "proportion true" statistic, not a coercion bug; this is INTENTIONAL, not
// an oversight.
it("coerceNumericValues: numbers pass through, numeric strings coerce, booleans become 1/0 " +
  "(intentional), whitespace-only strings and other junk are dropped", () => {
  expect(coerceNumericValues([10, "12", "", null, "n/a", undefined, "3.5", "   ", true, false]))
    .toEqual([10, 12, 3.5, 1, 0]);
});

it("computeStats: known values (sample stdDev, n-1)", () => {
  const s = computeStats([1, 2, 3, 4]);
  expect(s.count).toBe(4);
  expect(s.mean).toBeCloseTo(2.5, 10);
  expect(s.median).toBeCloseTo(2.5, 10);
  expect(s.stdDev).toBeCloseTo(1.2909944487, 6);   // sqrt(5/3)
  expect(s.min).toBe(1);
  expect(s.max).toBe(4);
});

it("computeStats: odd-count median", () => {
  expect(computeStats([3, 1, 2]).median).toBe(2);
});

it("computes stats from fetched values, ignoring non-numeric entries", async () => {
  (getCollectionItemsForAttribute as jest.Mock).mockResolvedValue([
    { id: "1", values: { Height: 10 } },
    { id: "2", values: { Height: "12" } },
    { id: "3", values: { Height: "" } },
    { id: "4", values: { Height: "n/a" } },
  ]);
  const v = getStatsTool.validate({ dataContext: "Mammals", attribute: "Height" }, ctx);
  expect(v.ok).toBe(true);
  const out = await getStatsTool.execute((v as any).resolved, ctx);
  expect(out).toContain("computed from 2 numeric cases");
  expect(out).toContain("mean 11");
  expect(out).toContain("min 10");
});

// A bare `n.toPrecision(6)` formatter switches to exponential notation once a non-integer
// value's integer part has more digits than the requested precision (e.g. "1.23457e+6"), which
// reads badly spoken aloud. Reusing graph-sketch.ts's roundSig (via the shared number-format.ts)
// at 6 significant figures keeps the same precision level but never emits e-notation.
it("never emits exponential notation for a large non-integer mean", async () => {
  (getCollectionItemsForAttribute as jest.Mock).mockResolvedValue([
    { id: "1", values: { Height: 1234567 } },
    { id: "2", values: { Height: 1234568.78 } },
  ]);
  const v = getStatsTool.validate({ dataContext: "Mammals", attribute: "Height" }, ctx);
  const out = await getStatsTool.execute((v as any).resolved, ctx);
  expect(out).not.toMatch(/e[+-]\d/i);
  expect(out).toContain("mean 1234570");
});

// An extreme-magnitude value (e.g. a malformed/adversarial dataset entry) must never crash
// get_stats' own formatter (roundSig at sig=6) with a RangeError, and must never render in
// exponential notation (unspeakable prose).
it("does not throw and never emits exponential notation for extreme-magnitude values", async () => {
  (getCollectionItemsForAttribute as jest.Mock).mockResolvedValue([
    { id: "1", values: { Height: 1e-307 } },
    { id: "2", values: { Height: 2e-307 } },
  ]);
  const v = getStatsTool.validate({ dataContext: "Mammals", attribute: "Height" }, ctx);
  const out = await getStatsTool.execute((v as any).resolved, ctx);
  expect(out).not.toMatch(/e[+-]\d/i);
});

it("errors correctively when fewer than 2 numeric values exist", async () => {
  (getCollectionItemsForAttribute as jest.Mock).mockResolvedValue([
    { id: "1", values: { Habitat: "land" } },
  ]);
  const v = getStatsTool.validate({ dataContext: "Mammals", attribute: "Habitat" }, ctx);
  expect(v.ok).toBe(true); // numeric check happens at execute (value sniffing)
  const out = await getStatsTool.execute((v as any).resolved, ctx);
  expect(out).toMatch(/not numeric|fewer than 2 numeric/i);
});
