jest.mock("../../codap-api-utils", () => ({ getCollectionItemsForAttribute: jest.fn() }));
import { getCollectionItemsForAttribute } from "../../codap-api-utils";
import { getStatsTool, computeStats, coerceNumericValues } from "./get-stats";
import { ILocalToolContext } from "./registry";

const dc = { name: "Mammals", collections: [{ name: "Cases", attrs: [{ name: "Height" }, { name: "Habitat" }] }] };
const ctx = { dataContexts: () => ({ Mammals: dc }) } as unknown as ILocalToolContext;

// DAVAI-126 Task B: graph-sketch.ts reuses this exact coercion (imported, not duplicated) — this
// test locks its contract (numbers pass through, numeric strings coerce, "", null, and
// non-numeric strings are dropped) so both call sites can rely on identical behavior.
it("coerceNumericValues: numbers pass through, numeric strings coerce, junk is dropped", () => {
  expect(coerceNumericValues([10, "12", "", null, "n/a", undefined, "3.5"])).toEqual([10, 12, 3.5]);
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

it("errors correctively when fewer than 2 numeric values exist", async () => {
  (getCollectionItemsForAttribute as jest.Mock).mockResolvedValue([
    { id: "1", values: { Habitat: "land" } },
  ]);
  const v = getStatsTool.validate({ dataContext: "Mammals", attribute: "Habitat" }, ctx);
  expect(v.ok).toBe(true); // numeric check happens at execute (value sniffing)
  const out = await getStatsTool.execute((v as any).resolved, ctx);
  expect(out).toMatch(/not numeric|fewer than 2 numeric/i);
});
