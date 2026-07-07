import { updateGraphTool } from "./update-graph";
import { ILocalToolContext } from "./registry";

const dc = {
  name: "Mammals",
  collections: [{ name: "Cases", attrs: [{ name: "Height" }, { name: "Mass" }, { name: "Sleep" }, { name: "Habitat" }] }],
};
const graphs = [
  { id: 42, title: "Height vs Mass", dataContext: "Mammals", xAttributeName: "Height", yAttributeName: "Mass", plotType: "scatterPlot" },
];
const send = jest.fn();
const refreshGraphList = jest.fn().mockResolvedValue(undefined);
const ctx = {
  dataContexts: () => ({ Mammals: dc }),
  graphs: () => graphs,
  selectedGraphId: () => "42",
  sendCODAPRequest: send,
  refreshGraphList,
} as unknown as ILocalToolContext;

beforeEach(() => {
  jest.clearAllMocks();
  send.mockResolvedValue({ success: true });
});

describe("validate", () => {
  it("resolves the graph via the full ladder's rung 3 (axis + plot-type phrasing), not just " +
    "rung 1/2 name matching", () => {
    // "the mass and height scatterplot" doesn't match "Height vs Mass" by name (rungs 1-2), but
    // rung 3's plot-type filter (graphBucket === "bivariate", since this fixture's plotType is
    // "scatterPlot") plus axis-substring scoring (both "mass" and "height" appear) resolves it.
    const v = updateGraphTool.validate({ graph: "the mass and height scatterplot", yAttribute: "Sleep" }, ctx);
    expect(v.ok).toBe(true);
    expect((v as any).resolved.graphId).toBe(42);
  });

  it("resolves the graph by exact title", () => {
    const v = updateGraphTool.validate({ graph: "Height vs Mass", yAttribute: "Sleep" }, ctx);
    expect(v.ok).toBe(true);
    expect((v as any).resolved.yAttributeName).toBe("Sleep");
  });

  it("defaults to the selected graph when graph is omitted", () => {
    const v = updateGraphTool.validate({ yAttribute: "Sleep" }, ctx);
    expect(v.ok).toBe(true);
    expect((v as any).resolved.graphId).toBe(42);
  });

  it("gives resolveGraph's corrective when no graph matches", () => {
    const v = updateGraphTool.validate({ graph: "Nonexistent", yAttribute: "Sleep" }, ctx);
    expect(v.ok).toBe(false);
    expect((v as any).error).toMatch(/no graph matches/i);
  });

  it("resolves xAttribute, yAttribute, and legendAttribute against the graph's own dataContext", () => {
    const v = updateGraphTool.validate(
      { graph: "Height vs Mass", xAttribute: "sleep", yAttribute: "mass", legendAttribute: "habitat" }, ctx);
    expect(v.ok).toBe(true);
    const r = (v as any).resolved;
    expect(r.xAttributeName).toBe("Sleep");
    expect(r.yAttributeName).toBe("Mass");
    expect(r.legendAttributeName).toBe("Habitat");
  });

  it("rejects an unknown xAttribute before any request", () => {
    const v = updateGraphTool.validate({ graph: "Height vs Mass", xAttribute: "Speed" }, ctx);
    expect(v.ok).toBe(false);
    expect((v as any).error).toContain("Height");
    expect(send).not.toHaveBeenCalled();
  });

  it("rejects an unknown yAttribute before any request", () => {
    const v = updateGraphTool.validate({ graph: "Height vs Mass", yAttribute: "Speed" }, ctx);
    expect(v.ok).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it("rejects an unknown legendAttribute before any request", () => {
    const v = updateGraphTool.validate({ graph: "Height vs Mass", legendAttribute: "Speed" }, ctx);
    expect(v.ok).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it("rejects an unknown title-only change is fine — title needs no resolution", () => {
    const v = updateGraphTool.validate({ graph: "Height vs Mass", title: "New Title" }, ctx);
    expect(v.ok).toBe(true);
    expect((v as any).resolved.title).toBe("New Title");
  });

  it("requires at least one change field", () => {
    const v = updateGraphTool.validate({ graph: "Height vs Mass" }, ctx);
    expect(v.ok).toBe(false);
    expect((v as any).error).toMatch(/xAttribute/i);
    expect((v as any).error).toMatch(/yAttribute/i);
    expect((v as any).error).toMatch(/legendAttribute/i);
    expect((v as any).error).toMatch(/title/i);
  });

  it("corrective when the resolved graph has no dataContext", () => {
    const noDcGraphs = [{ id: 99, title: "Orphan Graph" }];
    const noDcCtx = { ...ctx, graphs: () => noDcGraphs, selectedGraphId: () => "99" } as unknown as ILocalToolContext;
    const v = updateGraphTool.validate({ graph: "Orphan Graph", yAttribute: "Sleep" }, noDcCtx);
    expect(v.ok).toBe(false);
    expect((v as any).error).toMatch(/data ?context/i);
  });

  describe("legend removal (v1: set-only, not documented as a removal form)", () => {
    it("legendAttribute \"none\" is rejected with a corrective saying removal isn't supported yet", () => {
      const v = updateGraphTool.validate({ graph: "Height vs Mass", legendAttribute: "none" }, ctx);
      expect(v.ok).toBe(false);
      expect((v as any).error).toMatch(/not supported/i);
      expect(send).not.toHaveBeenCalled();
    });

    it("legendAttribute \"\" (empty) is treated as no change, not as a removal request", () => {
      // Omitting/empty legendAttribute alongside no other change field hits the standard
      // no-change corrective, not a removal path — there is no removal path in v1.
      const v = updateGraphTool.validate({ graph: "Height vs Mass", legendAttribute: "" }, ctx);
      expect(v.ok).toBe(false);
      expect((v as any).error).toMatch(/xAttribute/i);
    });
  });
});

describe("execute: single-change updates", () => {
  it("y-axis alone sends only yAttributeName in values", async () => {
    const v = updateGraphTool.validate({ graph: "Height vs Mass", yAttribute: "Sleep" }, ctx);
    const out = await updateGraphTool.execute((v as any).resolved, ctx);
    expect(send).toHaveBeenCalledWith({
      action: "update",
      resource: "component[42]",
      values: { yAttributeName: "Sleep" },
    });
    expect(out).toBe('Updated graph "Height vs Mass": y-axis is now Sleep.');
  });

  it("x-axis alone", async () => {
    const v = updateGraphTool.validate({ graph: "Height vs Mass", xAttribute: "Sleep" }, ctx);
    const out = await updateGraphTool.execute((v as any).resolved, ctx);
    expect(send).toHaveBeenCalledWith({
      action: "update",
      resource: "component[42]",
      values: { xAttributeName: "Sleep" },
    });
    expect(out).toBe('Updated graph "Height vs Mass": x-axis is now Sleep.');
  });

  it("legend alone", async () => {
    const v = updateGraphTool.validate({ graph: "Height vs Mass", legendAttribute: "Habitat" }, ctx);
    const out = await updateGraphTool.execute((v as any).resolved, ctx);
    expect(send).toHaveBeenCalledWith({
      action: "update",
      resource: "component[42]",
      values: { legendAttributeName: "Habitat" },
    });
    expect(out).toBe('Updated graph "Height vs Mass": legend is now Habitat.');
  });

  it("title alone", async () => {
    const v = updateGraphTool.validate({ graph: "Height vs Mass", title: "Body Stats" }, ctx);
    const out = await updateGraphTool.execute((v as any).resolved, ctx);
    expect(send).toHaveBeenCalledWith({
      action: "update",
      resource: "component[42]",
      values: { title: "Body Stats" },
    });
    // Uses the NEW title in the result sentence once the rename succeeds.
    expect(out).toBe('Updated graph "Body Stats": title is now "Body Stats".');
  });
});

describe("execute: multi-change", () => {
  it("combines x/y/legend/title into one component update and one enumerated sentence", async () => {
    const v = updateGraphTool.validate(
      { graph: "Height vs Mass", xAttribute: "Sleep", yAttribute: "Height", legendAttribute: "Habitat", title: "Body Stats" }, ctx);
    const out = await updateGraphTool.execute((v as any).resolved, ctx);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({
      action: "update",
      resource: "component[42]",
      values: { xAttributeName: "Sleep", yAttributeName: "Height", legendAttributeName: "Habitat", title: "Body Stats" },
    });
    expect(out).toBe(
      'Updated graph "Body Stats": x-axis is now Sleep; y-axis is now Height; legend is now Habitat; title is now "Body Stats".'
    );
  });
});

describe("execute: refresh behavior (no selectNewest side effect)", () => {
  it("calls ctx.refreshGraphList() after success, NOT refreshGraphs (which carries selectNewest " +
    "semantics that could steal the current selection on a same-graph update)", async () => {
    const v = updateGraphTool.validate({ graph: "Height vs Mass", yAttribute: "Sleep" }, ctx);
    await updateGraphTool.execute((v as any).resolved, ctx);
    expect(refreshGraphList).toHaveBeenCalled();
  });

  it("does not refresh on failure", async () => {
    send.mockResolvedValue({ success: false, error: "bad attribute" });
    const v = updateGraphTool.validate({ graph: "Height vs Mass", yAttribute: "Sleep" }, ctx);
    await updateGraphTool.execute((v as any).resolved, ctx);
    expect(refreshGraphList).not.toHaveBeenCalled();
  });
});

describe("execute: failure handling", () => {
  it("summarizes a CODAP failure using the documented top-level error shape", async () => {
    send.mockResolvedValue({ success: false, error: "unknown attribute" });
    const v = updateGraphTool.validate({ graph: "Height vs Mass", yAttribute: "Sleep" }, ctx);
    const out = await updateGraphTool.execute((v as any).resolved, ctx);
    expect(out).toMatch(/update failed/i);
    expect(out).toContain("unknown attribute");
  });

  it("falls back to values.error when the top-level error is absent (tolerance)", async () => {
    send.mockResolvedValue({ success: false, values: { error: "nested unknown attribute" } });
    const v = updateGraphTool.validate({ graph: "Height vs Mass", yAttribute: "Sleep" }, ctx);
    const out = await updateGraphTool.execute((v as any).resolved, ctx);
    expect(out).toMatch(/update failed/i);
    expect(out).toContain("nested unknown attribute");
  });
});
