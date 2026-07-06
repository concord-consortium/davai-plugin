import {
  normalizeName, resolveByName, resolveDataContext, resolveCollection,
  resolveAttribute, resolveGraph, extractBacktickRefs, listNames
} from "./resolve";

const dc = {
  name: "Mammals",
  collections: [
    { name: "Cases", attrs: [{ name: "Height" }, { name: "Sleep_hours" }, { name: "Habitat" }] },
  ],
};
const dcs = { Mammals: dc };

describe("normalizeName", () => {
  it("lowercases, trims, and collapses spaces/underscores/hyphens", () => {
    expect(normalizeName("  Sleep_hours ")).toBe("sleep hours");
    expect(normalizeName("sleep-HOURS")).toBe("sleep hours");
    expect(normalizeName("Sleep  Hours")).toBe("sleep hours");
  });
});

describe("resolveByName ladder", () => {
  const candidates = [
    { name: "Height", value: 1 },
    { name: "Sleep_hours", value: 2 },
  ];
  it("rung 1: exact match, not repaired", () => {
    const r = resolveByName("attribute", "Height", candidates);
    expect(r).toEqual({ ok: true, value: 1, repaired: false });
  });
  it("rung 2: unique normalized match repairs silently", () => {
    const r = resolveByName("attribute", "sleep hours", candidates);
    expect(r).toEqual({ ok: true, value: 2, repaired: true });
  });
  it("rung 3: no match yields corrective error listing candidates", () => {
    const r = resolveByName("attribute", "Speed", candidates);
    if (r.ok) throw new Error("should fail");
    expect(r.error).toContain('Unknown attribute "Speed"');
    expect(r.error).toContain("Height");
    expect(r.error).toContain("Sleep_hours");
  });
  it("rung 3: ambiguous normalized match lists candidates, never guesses", () => {
    const ambiguous = [{ name: "height", value: 1 }, { name: "Height", value: 2 }];
    const r = resolveByName("attribute", "HEIGHT", ambiguous);
    if (r.ok) throw new Error("should fail");
    expect(r.error).toMatch(/matches more than one/i);
  });
});

describe("domain resolvers", () => {
  it("resolves data context and attribute (with owning collection)", () => {
    const c = resolveDataContext("mammals", dcs);
    expect(c.ok).toBe(true);
    const a = resolveAttribute("sleep hours", dc);
    if (!a.ok) throw new Error("should succeed");
    expect(a.value.attr.name).toBe("Sleep_hours");
    expect(a.value.collection.name).toBe("Cases");
  });
  it("collection defaults when single, errors when absent from multi-collection context", () => {
    const single = resolveCollection(undefined, dc);
    expect(single.ok).toBe(true);
    const multi = { name: "M", collections: [{ name: "A", attrs: [] }, { name: "B", attrs: [] }] };
    const r = resolveCollection(undefined, multi);
    if (r.ok) throw new Error("should fail");
    expect(r.error).toMatch(/A, B/);
  });
  it("resolveGraph defaults to the selected graph and errors with none", () => {
    const graphs = [{ id: 42, name: "G1", title: "Height vs Age" }];
    const sel = resolveGraph(undefined, graphs, "42");
    expect(sel.ok).toBe(true);
    const byTitle = resolveGraph("height vs age", graphs, null);
    expect(byTitle.ok).toBe(true);
    const none = resolveGraph(undefined, graphs, null);
    if (none.ok) throw new Error("should fail");
    expect(none.error).toMatch(/no graph is selected/i);
  });
});

describe("helpers", () => {
  it("extracts backticked refs from expressions", () => {
    expect(extractBacktickRefs("`Weight` > mean(`Weight in kg`)")).toEqual(["Weight", "Weight in kg"]);
    expect(extractBacktickRefs("count()")).toEqual([]);
  });
  it("caps listed names at 12 with ellipsis", () => {
    const names = Array.from({ length: 15 }, (_, i) => `A${i}`);
    const s = listNames(names);
    expect(s).toContain("A11");
    expect(s).not.toContain("A12");
    expect(s).toContain("…");
  });
});
