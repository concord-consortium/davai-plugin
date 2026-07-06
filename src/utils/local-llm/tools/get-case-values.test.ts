jest.mock("../../codap-api-utils", () => ({
  getCollectionItemsForAttribute: jest.fn(),
  getCollectionItemsForAttributePair: jest.fn(),
}));
import { getCollectionItemsForAttribute, getCollectionItemsForAttributePair } from "../../codap-api-utils";
import { getCaseValuesTool, capValues } from "./get-case-values";
import { ILocalToolContext } from "./registry";

const dc = { name: "Mammals", collections: [{ name: "Cases", attrs: [{ name: "Height" }, { name: "Mass" }] }] };
const ctx = { dataContexts: () => ({ Mammals: dc }) } as unknown as ILocalToolContext;

beforeEach(() => jest.clearAllMocks());

it("capValues keeps all under cap; samples evenly and flags over cap", () => {
  const under = capValues([1, 2, 3], 100);
  expect(under).toEqual({ kept: [1, 2, 3], sampled: false, total: 3 });
  const over = capValues(Array.from({ length: 250 }, (_, i) => i), 100);
  expect(over.kept.length).toBe(100);
  expect(over.sampled).toBe(true);
  expect(over.total).toBe(250);
  expect(over.kept[0]).toBe(0);
});

it("fetches single-attribute values with ladder repair on the attribute name", async () => {
  (getCollectionItemsForAttribute as jest.Mock).mockResolvedValue(
    [{ id: "1", values: { Height: 10 } }, { id: "2", values: { Height: 12 } }]
  );
  const v = getCaseValuesTool.validate({ dataContext: "mammals", attribute: "height" }, ctx);
  expect(v.ok).toBe(true);
  const out = await getCaseValuesTool.execute((v as any).resolved, ctx);
  expect(out).toContain("Height");
  expect(out).toContain("10");
  expect(out).toContain("2 cases");
});

it("fetches attribute pairs via the pair fetcher", async () => {
  (getCollectionItemsForAttributePair as jest.Mock).mockResolvedValue(
    [{ id: "1", values: { Height: 10, Mass: 4 } }]
  );
  const v = getCaseValuesTool.validate({ dataContext: "Mammals", attribute: "Height", attribute2: "Mass" }, ctx);
  expect(v.ok).toBe(true);
  await getCaseValuesTool.execute((v as any).resolved, ctx);
  expect(getCollectionItemsForAttributePair).toHaveBeenCalled();
});

it("unknown attribute yields the corrective options list", () => {
  const v = getCaseValuesTool.validate({ dataContext: "Mammals", attribute: "Speed" }, ctx);
  expect(v.ok).toBe(false);
  expect(!v.ok && v.error).toContain("Height");
});
