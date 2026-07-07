jest.mock("../../codap-api-utils", () => ({
  getGraphByID: jest.fn(),
  getGraphAdornments: jest.fn(),
  getCollectionItemsForAttribute: jest.fn(),
  getCollectionItemsForAttributePair: jest.fn(),
}));
import {
  getGraphByID, getGraphAdornments, getCollectionItemsForAttribute, getCollectionItemsForAttributePair
} from "../../codap-api-utils";
import { getGraphInfoTool } from "./get-graph-info";
import { ILocalToolContext } from "./registry";

const graphs = [{ id: 42, title: "Height vs Age", xAttributeName: "Height", yAttributeName: "Age" }];
const dcs = {
  Mammals: { name: "Mammals", collections: [{ name: "Cases", attrs: [{ name: "Height" }, { name: "Age" }] }] },
};
const ctx = {
  graphs: () => graphs,
  selectedGraphId: () => "42",
  dataContexts: () => dcs,
} as unknown as ILocalToolContext;

beforeEach(() => {
  jest.clearAllMocks();
  (getGraphByID as jest.Mock).mockResolvedValue({
    id: 42, title: "Height vs Age", xAttributeName: "Height", yAttributeName: "Age", dataContext: "Mammals",
  });
  (getGraphAdornments as jest.Mock).mockResolvedValue([{ type: "Mean", isVisible: true, value: 12.3 }]);
  (getCollectionItemsForAttributePair as jest.Mock).mockResolvedValue([]);
  (getCollectionItemsForAttribute as jest.Mock).mockResolvedValue([]);
});

it("defaults to the selected graph and reports structure + adornments", async () => {
  const v = getGraphInfoTool.validate({}, ctx);
  expect(v.ok).toBe(true);
  const out = await getGraphInfoTool.execute((v as any).resolved, ctx);
  expect(out).toContain("Height vs Age");
  expect(out).toContain("Height");
  expect(out).toContain("Mean");
  expect(out).toContain("12.3");
});

// Same LSRL branch as buildGraphSeed's adornments line: slope/intercept/rSquared, never
// "mean undefined, min undefined, max undefined".
it("renders an LSRL adornment as slope/intercept/R² on the adornments line", async () => {
  (getGraphAdornments as jest.Mock).mockResolvedValue([
    { type: "LSRL", isVisible: true, slope: 2.5, intercept: 1.2, rSquared: 0.87 },
  ]);
  const v = getGraphInfoTool.validate({}, ctx);
  const out = await getGraphInfoTool.execute((v as any).resolved, ctx);
  expect(out).toContain("Adornments: LSRL: slope 2.5, intercept 1.2, R² 0.87.");
  expect(out).not.toContain("undefined");
});

it("errors correctively when no graph is selected and none named", () => {
  const v = getGraphInfoTool.validate({}, { ...ctx, selectedGraphId: () => null } as any);
  expect(v.ok).toBe(false);
  expect(!v.ok && v.error).toMatch(/no graph is selected/i);
});

// DAVAI-126 matrix round 3 item E1: result string used `graph?.title ?? graph?.name ??
// resolved.graphId` — evidence: `Added Mean adornment to "undefined"` style bugs elsewhere from
// the same raw-fallback pattern. Now uses the shared graphLabel (empty-string-safe, descriptive
// fallback over a raw id).
it("uses the shared graphLabel (descriptive fallback) when the graph has neither title nor name", async () => {
  (getGraphByID as jest.Mock).mockResolvedValue({
    id: 42, xAttributeName: "Height", yAttributeName: "Age", dataContext: "Mammals",
  });
  const v = getGraphInfoTool.validate({}, ctx);
  const out = await getGraphInfoTool.execute((v as any).resolved, ctx);
  expect(out).toContain('Graph "the Height vs Age scatterplot"');
});

it("treats an empty-string title as absent, not as a printed blank label", async () => {
  (getGraphByID as jest.Mock).mockResolvedValue({
    id: 42, title: "", xAttributeName: "Height", yAttributeName: "Age", dataContext: "Mammals",
  });
  const v = getGraphInfoTool.validate({}, ctx);
  const out = await getGraphInfoTool.execute((v as any).resolved, ctx);
  expect(out).not.toContain('Graph ""');
  expect(out).toContain('Graph "the Height vs Age scatterplot"');
});

it("steers the model away from a redundant call when the data is already in the seed " +
  "(DAVAI-126 eval round 2 item D)", () => {
  expect(getGraphInfoTool.description).toContain("Selected graph data");
  expect(getGraphInfoTool.description).toMatch(/call this only for a different graph or after making a change/i);
});

// DAVAI-126 matrix round 4 Task F2: live trace evidence — a small (1.7B/none) model copied the
// argsExample's concrete fake graph name "Height vs Age" verbatim into a real call on a document
// that had no such graph. The no-arg form must be the ONLY form in argsExample (nothing left to
// copy); the optional "graph" usage still needs to be documented, but in description prose with
// no concrete fake name to imitate.
it("argsExample shows ONLY the no-arg form — no fake graph name for a small model to copy verbatim", () => {
  expect(getGraphInfoTool.argsExample).toBe('{"tool": "get_graph_info"}');
  expect(getGraphInfoTool.argsExample).not.toMatch(/height/i);
});

it("documents the optional graph argument in description prose without a concrete fake graph name", () => {
  expect(getGraphInfoTool.description).toMatch(/pass "graph"/i);
  expect(getGraphInfoTool.description).not.toMatch(/height/i);
});

// DAVAI-126 Task B: get_graph_info fetches axis values (via the same fetchers buildGraphSeed
// uses) and appends the same computed sketch a describe request gets from the seed — so a
// redundant-but-harmless call (e.g. after describing a DIFFERENT graph than the seeded one)
// still gets client-computed cluster/outlier/relationship facts, not a bare structure dump.
describe("graph sketch appended to the tool result", () => {
  it("appends a non-empty sketch and the final checklist line when there is enough numeric data", async () => {
    (getCollectionItemsForAttributePair as jest.Mock).mockResolvedValue([
      { id: "1", values: { Height: 1, Age: 2 } },
      { id: "2", values: { Height: 2, Age: 4 } },
      { id: "3", values: { Height: 3, Age: 6 } },
    ]);
    const v = getGraphInfoTool.validate({}, ctx);
    const out = await getGraphInfoTool.execute((v as any).resolved, ctx);
    expect(out).toContain("Sketch: 3 points.");
    expect(out).toContain(
      "Describe: axes and units, where most points lie, the outliers above, and what the relationship numbers mean in plain words."
    );
  });

  // DAVAI-126 matrix round 5 Task G3: the one round-5 failure — after create_graph succeeded, the
  // model fetched get_graph_info and followed the describe-checklist so literally that its final
  // never mentioned a graph was created at all (failed /graph|plot/i; the answer began "Axes:
  // x-axis is..."). The checklist steered a post-create fetch into pure description, silently
  // dropping the action the user actually cares about hearing confirmed. One added clause fixes
  // it: acknowledge the just-completed action before falling into the description checklist.
  it("extends the checklist with an action-first clause so a post-create/change fetch " +
    "acknowledges the action before describing (DAVAI-126 matrix round 5 Task G3)", async () => {
    (getCollectionItemsForAttributePair as jest.Mock).mockResolvedValue([
      { id: "1", values: { Height: 1, Age: 2 } },
      { id: "2", values: { Height: 2, Age: 4 } },
      { id: "3", values: { Height: 3, Age: 6 } },
    ]);
    const v = getGraphInfoTool.validate({}, ctx);
    const out = await getGraphInfoTool.execute((v as any).resolved, ctx);
    expect(out).toContain("If you just created or changed a graph, say that first.");
  });

  it("omits both the sketch and the checklist line when there's not enough numeric data " +
    "(fewer than 2 numeric pairs)", async () => {
    (getCollectionItemsForAttributePair as jest.Mock).mockResolvedValue([
      { id: "1", values: { Height: 1, Age: "n/a" } },
    ]);
    const v = getGraphInfoTool.validate({}, ctx);
    const out = await getGraphInfoTool.execute((v as any).resolved, ctx);
    expect(out).not.toMatch(/Sketch:/);
    expect(out).not.toMatch(/Describe:/);
  });

  it("reuses getCollectionItemsForAttributePair for a two-axis graph and " +
    "getCollectionItemsForAttribute for a single-axis graph, matching buildGraphSeed's own fetcher choice", async () => {
    (getGraphByID as jest.Mock).mockResolvedValue({
      id: 42, title: "Height only", xAttributeName: "Height", yAttributeName: null, dataContext: "Mammals",
    });
    (getCollectionItemsForAttribute as jest.Mock).mockResolvedValue([
      { id: "1", values: { Height: 10 } }, { id: "2", values: { Height: 12 } },
    ]);
    const v = getGraphInfoTool.validate({}, ctx);
    const out = await getGraphInfoTool.execute((v as any).resolved, ctx);
    expect(getCollectionItemsForAttribute).toHaveBeenCalledWith(dcs.Mammals, "Height");
    expect(getCollectionItemsForAttributePair).not.toHaveBeenCalled();
    expect(out).toContain("Sketch: 2 points.");
  });
});

// DAVAI-126 Task H: the checklist trailer must match the sketch's mode — a numeric-flavored
// checklist ("the outliers above", "relationship numbers") makes no sense appended to a
// categorical sketch (there is no "outliers above" or "relationship numbers" in category counts).
describe("checklist trailer adapts to the sketch mode (DAVAI-126 Task H)", () => {
  const dcWithDietHabitat = {
    name: "Mammals",
    collections: [{ name: "Cases", attrs: [{ name: "Diet" }, { name: "Habitat" }] }],
  };
  const ctxDietHabitat = {
    graphs: () => [{ id: 42, title: "Diet vs Habitat", xAttributeName: "Diet", yAttributeName: "Habitat" }],
    selectedGraphId: () => "42",
    dataContexts: () => ({ Mammals: dcWithDietHabitat }),
  } as unknown as ILocalToolContext;

  beforeEach(() => {
    (getGraphByID as jest.Mock).mockResolvedValue({
      id: 42, title: "Diet vs Habitat", xAttributeName: "Diet", yAttributeName: "Habitat", dataContext: "Mammals",
    });
  });

  it("appends the CATEGORICAL checklist (categories/counts/largest-smallest/empty combos) when " +
    "the sketch is a categorical mode, never the numeric outliers/relationship wording", async () => {
    (getCollectionItemsForAttributePair as jest.Mock).mockResolvedValue([
      { id: "1", values: { Diet: "meat", Habitat: "land" } },
      { id: "2", values: { Diet: "meat", Habitat: "land" } },
      { id: "3", values: { Diet: "plants", Habitat: "water" } },
    ]);
    const v = getGraphInfoTool.validate({}, ctxDietHabitat);
    const out = await getGraphInfoTool.execute((v as any).resolved, ctxDietHabitat);
    expect(out).toContain(
      "Describe: the categories and their counts, the largest and smallest groups, and any empty combinations."
    );
    expect(out).not.toMatch(/the outliers above|relationship numbers/);
  });

  it("still leads with the action-first clause on a categorical sketch (Task G's clause applies " +
    "to both trailer flavors)", async () => {
    (getCollectionItemsForAttributePair as jest.Mock).mockResolvedValue([
      { id: "1", values: { Diet: "meat", Habitat: "land" } },
      { id: "2", values: { Diet: "meat", Habitat: "land" } },
      { id: "3", values: { Diet: "plants", Habitat: "water" } },
    ]);
    const v = getGraphInfoTool.validate({}, ctxDietHabitat);
    const out = await getGraphInfoTool.execute((v as any).resolved, ctxDietHabitat);
    expect(out).toContain("If you just created or changed a graph, say that first.");
  });

  it("keeps the numeric checklist wording unchanged for a numeric sketch (regression: Task H " +
    "must not alter the existing numeric-mode trailer)", async () => {
    // Explicit numeric-graph mock (not the outer file's beforeEach) — this describe block's own
    // beforeEach overrides getGraphByID for the Diet/Habitat fixture, so the numeric case needs
    // its own self-contained override rather than relying on shadowed outer state.
    (getGraphByID as jest.Mock).mockResolvedValue({
      id: 42, title: "Height vs Age", xAttributeName: "Height", yAttributeName: "Age", dataContext: "Mammals",
    });
    (getCollectionItemsForAttributePair as jest.Mock).mockResolvedValue([
      { id: "1", values: { Height: 1, Age: 2 } },
      { id: "2", values: { Height: 2, Age: 4 } },
      { id: "3", values: { Height: 3, Age: 6 } },
    ]);
    const v = getGraphInfoTool.validate({}, ctx);
    const out = await getGraphInfoTool.execute((v as any).resolved, ctx);
    expect(out).toContain(
      "Describe: axes and units, where most points lie, the outliers above, and what the relationship numbers mean in plain words."
    );
    expect(out).not.toMatch(/largest and smallest groups|empty combinations/);
  });

  it("appends the categorical checklist for a categorical x numeric sketch too (not just cat x cat)", async () => {
    (getCollectionItemsForAttributePair as jest.Mock).mockResolvedValue([
      { id: "1", values: { Diet: "meat", Habitat: 1.2 } },
      { id: "2", values: { Diet: "meat", Habitat: 1.4 } },
      { id: "3", values: { Diet: "plants", Habitat: 2.1 } },
    ]);
    const v = getGraphInfoTool.validate({}, ctxDietHabitat);
    const out = await getGraphInfoTool.execute((v as any).resolved, ctxDietHabitat);
    expect(out).toContain(
      "Describe: the categories and their counts, the largest and smallest groups, and any empty combinations."
    );
  });
});
