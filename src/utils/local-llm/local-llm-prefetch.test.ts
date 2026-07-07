jest.mock("../codap-api-utils", () => ({
  getGraphByID: jest.fn(),
  getGraphAdornments: jest.fn(),
  getCollectionItemsForAttribute: jest.fn(),
  getCollectionItemsForAttributePair: jest.fn(),
}));
import {
  getGraphByID, getGraphAdornments, getCollectionItemsForAttribute, getCollectionItemsForAttributePair
} from "../codap-api-utils";
import { buildSchemaDigest, buildGraphSeed, deriveCurrentGraphId } from "./local-llm-prefetch";

describe("deriveCurrentGraphId (DAVAI-126 current-graph fix)", () => {
  it("explicit selection wins over any graph list, including when it's a number", () => {
    expect(deriveCurrentGraphId(42, [{ id: 1 }, { id: 2 }])).toBe("42");
    expect(deriveCurrentGraphId("42", [{ id: 1 }, { id: 2 }])).toBe("42");
  });

  it("falls back to the sole graph's id when nothing is explicitly selected", () => {
    expect(deriveCurrentGraphId(null, [{ id: 7 }])).toBe("7");
    expect(deriveCurrentGraphId(undefined, [{ id: 7 }])).toBe("7");
  });

  it("returns null when there are zero graphs and nothing is selected", () => {
    expect(deriveCurrentGraphId(null, [])).toBeNull();
  });

  it("returns null when there are multiple graphs and nothing is explicitly selected " +
    "(ambiguous — cannot guess which one is current)", () => {
    expect(deriveCurrentGraphId(null, [{ id: 1 }, { id: 2 }])).toBeNull();
  });

  it("treats an empty-string selection as unset, still falling back to a single graph", () => {
    expect(deriveCurrentGraphId("", [{ id: 7 }])).toBe("7");
    expect(deriveCurrentGraphId("", [{ id: 1 }, { id: 2 }])).toBeNull();
  });
});

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

  it("includes structure, adornments, and all values for a univariate graph", async () => {
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

  it("includes ALL values with no sampling note when the graph has over 100 cases " +
    "(DAVAI-126 user directive)", async () => {
    const items = Array.from({ length: 150 }, (_, i) => ({ id: String(i), values: { Height: i } }));
    (getCollectionItemsForAttribute as jest.Mock).mockResolvedValue(items);

    const seed = await buildGraphSeed("42", dcs);

    expect(seed).toContain("150 cases");
    expect(seed).not.toMatch(/sampled/i);
    const valuesLine = seed.split("\n").find((l) => l.startsWith("Values"))!;
    const rows = valuesLine.split(": ").slice(1).join(": ").split("; ");
    expect(rows).toHaveLength(150);
    expect(rows[0]).toBe("0");
    expect(rows[149]).toBe("149");
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
