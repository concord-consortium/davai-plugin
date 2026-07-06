jest.mock("../codap-api-utils", () => ({
  getGraphByID: jest.fn(),
  getGraphAdornments: jest.fn(),
  getCollectionItemsForAttribute: jest.fn(),
  getCollectionItemsForAttributePair: jest.fn(),
}));
import {
  getGraphByID, getGraphAdornments, getCollectionItemsForAttribute, getCollectionItemsForAttributePair
} from "../codap-api-utils";
import { buildSchemaDigest, buildGraphSeed } from "./local-llm-prefetch";

const dcs = {
  Mammals: {
    name: "Mammals",
    collections: [{ name: "Cases", attrs: [
      { name: "Height", type: "numeric" }, { name: "Habitat", type: "categorical" }, { name: "Mass" },
    ]}],
  },
};

it("builds a compact schema digest with names and types", () => {
  const digest = buildSchemaDigest(dcs);
  expect(digest).toContain("Mammals");
  expect(digest).toContain("Cases");
  expect(digest).toContain("Height (numeric)");
  expect(digest).toContain("Habitat (categorical)");
  expect(digest).toContain("Mass");
  expect(digest).not.toContain("_categoryMap");
  expect(digest.length).toBeLessThan(400);
});

describe("buildGraphSeed", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getGraphByID as jest.Mock).mockResolvedValue({
      id: 42, title: "Heights", dataContext: "Mammals", xAttributeName: "Height", yAttributeName: null,
    });
    (getGraphAdornments as jest.Mock).mockResolvedValue([{ type: "Mean", isVisible: true, value: 11 }]);
    (getCollectionItemsForAttribute as jest.Mock).mockResolvedValue([
      { id: "1", values: { Height: 10 } }, { id: "2", values: { Height: 12 } },
    ]);
  });

  it("includes structure, adornments, and capped values for a univariate graph", async () => {
    const seed = await buildGraphSeed("42", dcs);
    expect(seed).toContain("Heights");
    expect(seed).toContain("x-axis: Height");
    expect(seed).toContain("Mean: 11");
    expect(seed).toContain("10; 12");
    expect(seed).toContain("2 cases");
  });

  it("uses the pair fetcher when both axes have attributes", async () => {
    (getGraphByID as jest.Mock).mockResolvedValue({
      id: 42, title: "H vs M", dataContext: "Mammals", xAttributeName: "Height", yAttributeName: "Mass",
    });
    (getCollectionItemsForAttributePair as jest.Mock).mockResolvedValue([
      { id: "1", values: { Height: 10, Mass: 3 } },
    ]);
    const seed = await buildGraphSeed("42", dcs);
    expect(getCollectionItemsForAttributePair).toHaveBeenCalled();
    expect(seed).toContain("10, 3");
  });

  it("returns empty string when the graph has no plotted attributes or fetch fails", async () => {
    (getGraphByID as jest.Mock).mockResolvedValue({ id: 42, title: "Empty", dataContext: "Mammals" });
    expect(await buildGraphSeed("42", dcs)).toBe("");
    (getGraphByID as jest.Mock).mockRejectedValue(new Error("gone"));
    expect(await buildGraphSeed("42", dcs)).toBe("");
  });

  it("returns empty string when the graph's data context is not in the store", async () => {
    (getGraphByID as jest.Mock).mockResolvedValue({
      id: 42, title: "Orphan", dataContext: "NotARealContext", xAttributeName: "Height", yAttributeName: null,
    });
    expect(await buildGraphSeed("42", dcs)).toBe("");
  });
});
