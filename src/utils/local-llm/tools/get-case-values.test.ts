jest.mock("../../codap-api-utils", () => ({
  getCollectionItemsForAttribute: jest.fn(),
  getCollectionItemsForAttributePair: jest.fn(),
}));
import { getCollectionItemsForAttribute, getCollectionItemsForAttributePair } from "../../codap-api-utils";
import { getCaseValuesTool } from "./get-case-values";
import { ILocalToolContext } from "./registry";

const dc = { name: "Mammals", collections: [{ name: "Cases", attrs: [{ name: "Height" }, { name: "Mass" }] }] };
const ctx = { dataContexts: () => ({ Mammals: dc }) } as unknown as ILocalToolContext;

beforeEach(() => jest.clearAllMocks());

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

describe("no sampling — ships all case values (DAVAI-126 user directive)", () => {
  it("returns all 250 values for a 250-value fixture (spot-check first+last), with the full count " +
    "and no sampling text", async () => {
    const items = Array.from({ length: 250 }, (_, i) => ({ id: String(i), values: { Height: i } }));
    (getCollectionItemsForAttribute as jest.Mock).mockResolvedValue(items);
    const v = getCaseValuesTool.validate({ dataContext: "Mammals", attribute: "Height" }, ctx);
    expect(v.ok).toBe(true);
    const out = await getCaseValuesTool.execute((v as any).resolved, ctx);

    expect(out).toContain("250 cases");
    expect(out).not.toMatch(/sampled/i);
    const rows = out.split(": ").slice(1).join(": ").split("; ");
    expect(rows).toHaveLength(250);
    expect(rows[0]).toBe("0");
    expect(rows[249]).toBe("249");
  });

  it("the tool description no longer promises sampling above 100 cases", () => {
    expect(getCaseValuesTool.description).not.toMatch(/sampled above 100/i);
    expect(getCaseValuesTool.description).toBe(
      "Get the case values for one attribute (or a pair) from a data context."
    );
  });
});
