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

  it("resolveGraph's no-selection error lists available graph titles when graphs exist", () => {
    const graphs = [
      { id: 1, name: "g1", title: "Height vs Age" },
      { id: 2, name: "g2", title: "Sleep vs Weight" },
    ];
    const r = resolveGraph(undefined, graphs, null);
    if (r.ok) throw new Error("should fail");
    expect(r.error).toMatch(/no graph is selected/i);
    expect(r.error).toContain("Height vs Age");
    expect(r.error).toContain("Sleep vs Weight");
  });

  it("resolveGraph's no-selection error falls back to name and dedupes when there are no titles", () => {
    const graphs = [{ id: 1, name: "g1" }];
    const r = resolveGraph(undefined, graphs, null);
    if (r.ok) throw new Error("should fail");
    expect(r.error).toContain("g1");
  });

  it("resolveGraph's no-selection error is a clean no-options message when there are no graphs", () => {
    const r = resolveGraph(undefined, [], null);
    if (r.ok) throw new Error("should fail");
    expect(r.error).toMatch(/no graphs in this document/i);
    expect(r.error).toContain("create_graph");
  });

  it("resolveGraph does not treat a single graph's colliding title/name as ambiguous", () => {
    // A graph whose title and name normalize identically ("Heights" / "heights") must resolve
    // as one candidate, not two — otherwise resolveByName sees two "matches" for the same object
    // and incorrectly reports ambiguity.
    const graphs = [{ id: 1, title: "Heights", name: "heights" }];
    const r = resolveGraph("HEIGHTS", graphs, null);
    if (!r.ok) throw new Error(`should succeed, got error: ${r.error}`);
    expect(r.value.id).toBe(1);
    expect(r.repaired).toBe(true);
  });

  it("resolveGraph resolves two colliding-title graphs with no other distinguishing fields " +
    "via the true-duplicate tiebreak (newest wins) rather than reporting ambiguity", () => {
    // Internal `name` (g1 vs g2) differs, but per the tiebreak's field list, name is a fallback
    // display label, not an independent identity field (see contentKey in resolve.ts) — with no
    // axes/plotType/dataContext to differ on either, these two are content-identical, so the
    // true-duplicate tiebreak (highest id = most recent) applies rather than rung 4.
    const graphs = [
      { id: 1, title: "Heights", name: "g1" },
      { id: 2, title: "heights", name: "g2" },
    ];
    const r = resolveGraph("HEIGHTS", graphs, null);
    if (!r.ok) throw new Error(`should succeed, got error: ${r.error}`);
    expect(r.value.id).toBe(2);
    expect(r.repaired).toBe(true);
  });

  it("resolveGraph still reports genuine ambiguity across two colliding-title graphs that differ " +
    "in a tiebreak field (dataContext) — rung 4 descriptive, not the old \"matches more than one\"", () => {
    const graphs = [
      { id: 1, title: "Heights", name: "g1", dataContext: "Mammals" },
      { id: 2, title: "heights", name: "g2", dataContext: "Birds" },
    ];
    const r = resolveGraph("HEIGHTS", graphs, null);
    if (r.ok) throw new Error("differing dataContext must NOT be treated as a true duplicate — should fail");
    expect(r.error).toMatch(/heights/i);
    expect(r.error).not.toMatch(/matches more than one/i);
  });
});

describe("resolveGraph rung 3: axis + plot-type matching (DAVAI-126)", () => {
  // Fixture used across this describe block: a Height dot plot and a Height-vs-Mass scatterplot,
  // both sharing "Height" so substring scoring must disambiguate via the OTHER axis / plot type.
  const heightDotPlot = { id: 10, title: "Height", name: "graph10", xAttributeName: "Height" };
  const heightVsMass = {
    id: 20, title: "Height vs Mass", name: "graph20", xAttributeName: "Height", yAttributeName: "Mass",
  };

  it("axis single: \"the height graph\" matches only the dot plot uniquely (no title match at all)", () => {
    // A dedicated fixture (not the shared heightVsMass, which also uses Height as an axis and
    // would tie the score) — this isolates the case the brief names: exactly one graph has
    // "Height" as an axis at all, so scoring alone (no plot-type keyword in the request) is
    // already unique.
    const sleepVsMass = { id: 25, title: "Sleep vs Mass", name: "graph25", xAttributeName: "Sleep", yAttributeName: "Mass" };
    const graphs = [heightDotPlot, sleepVsMass];
    const r = resolveGraph("the height graph", graphs, null);
    if (!r.ok) throw new Error(`should succeed, got error: ${r.error}`);
    expect(r.value.id).toBe(10);
    expect(r.repaired).toBe(true);
  });

  it("axis pair flipped order: \"Describe the Mass vs Height graph\" scores both axes by substring, " +
    "not token/order equality", () => {
    const graphs = [heightDotPlot, heightVsMass];
    const r = resolveGraph("the mass vs height graph", graphs, null);
    if (!r.ok) throw new Error(`should succeed, got error: ${r.error}`);
    expect(r.value.id).toBe(20);
    expect(r.repaired).toBe(true);
  });

  it("plot-type filter selects the dot plot for \"height dot plot\"", () => {
    const graphs = [heightDotPlot, heightVsMass];
    const r = resolveGraph("height dot plot", graphs, null);
    if (!r.ok) throw new Error(`should succeed, got error: ${r.error}`);
    expect(r.value.id).toBe(10);
    expect(r.repaired).toBe(true);
  });

  it("plot-type filter selects the scatterplot for \"height scatterplot\"", () => {
    const graphs = [heightDotPlot, heightVsMass];
    const r = resolveGraph("height scatterplot", graphs, null);
    if (!r.ok) throw new Error(`should succeed, got error: ${r.error}`);
    expect(r.value.id).toBe(20);
    expect(r.repaired).toBe(true);
  });

  it("filter-eliminates-all falls to rung 4 rather than silently unfiltering", () => {
    // "scatterplot" demands both axes; only the dot plot exists, so the filter leaves zero
    // candidates. Rung 3 must fail outright here, not fall back to matching the dot plot anyway.
    const graphs = [heightDotPlot];
    const r = resolveGraph("height scatterplot", graphs, null);
    if (r.ok) throw new Error("should fail");
    expect(r.error).toMatch(/no graph matches/i);
  });

  it("tie at max score (two scatterplots both using Height) falls to rung 4, listing only those two", () => {
    const heightVsWeight = {
      id: 21, title: "Height vs Weight", name: "graph21", xAttributeName: "Height", yAttributeName: "Weight",
    };
    const unrelated = { id: 99, title: "Sleep vs Age", name: "graph99", xAttributeName: "Sleep", yAttributeName: "Age" };
    const graphs = [heightVsMass, heightVsWeight, unrelated];
    const r = resolveGraph("the height graph", graphs, null);
    if (r.ok) throw new Error("should fail");
    expect(r.error).toContain("Height vs Mass");
    expect(r.error).toContain("Height vs Weight");
    expect(r.error).not.toContain("Sleep vs Age");
  });

  it("max score of 0 after filtering (no axis name appears in the request) falls to rung 4", () => {
    const graphs = [heightDotPlot, heightVsMass];
    const r = resolveGraph("xyzzy", graphs, null);
    if (r.ok) throw new Error("should fail");
    expect(r.error).toMatch(/no graph matches/i);
  });

  it("scores a legend attribute name toward the total, not just x/y", () => {
    const withLegend = {
      id: 30, title: "Plot A", name: "graph30", xAttributeName: "Foo", yAttributeName: "Bar",
      legendAttributeName: "Habitat",
    };
    const withoutLegend = { id: 31, title: "Plot B", name: "graph31", xAttributeName: "Foo", yAttributeName: "Bar" };
    const graphs = [withLegend, withoutLegend];
    const r = resolveGraph("the foo bar habitat graph", graphs, null);
    if (!r.ok) throw new Error(`should succeed, got error: ${r.error}`);
    expect(r.value.id).toBe(30);
  });
});

describe("resolveGraph true-duplicate tiebreak: newest wins (DAVAI-126)", () => {
  it("rung 2: two graphs identical in title/name/plotType/axes/dataContext — highest id wins, repaired", () => {
    // CODAP component ids increase with creation order, so the highest numeric id is the most
    // recently created graph — the user's chosen tiebreak for genuinely indistinguishable dupes.
    const older = {
      id: 5, title: "Height", name: "g-older", plotType: "dotPlot", xAttributeName: "Height", dataContext: "Mammals",
    };
    const newer = {
      id: 8, title: "Height", name: "g-newer", plotType: "dotPlot", xAttributeName: "Height", dataContext: "Mammals",
    };
    const r = resolveGraph("height", [older, newer], null);
    if (!r.ok) throw new Error(`should succeed, got error: ${r.error}`);
    expect(r.value.id).toBe(8);
    expect(r.repaired).toBe(true);
  });

  it("rung 3: title alone differing between two axis/plot-type-identical candidates blocks the " +
    "tiebreak — rung 4 descriptive, not newest-wins", () => {
    const older = {
      id: 5, title: "A", name: "g-older", plotType: "scatterPlot",
      xAttributeName: "Height", yAttributeName: "Mass", dataContext: "Mammals",
    };
    const newer = {
      id: 8, title: "B", name: "g-newer", plotType: "scatterPlot",
      xAttributeName: "Height", yAttributeName: "Mass", dataContext: "Mammals",
    };
    // Both score equally on axes+plot-type for this phrase, and neither title matches it by
    // name — this exercises rung 3's own scoring tie, not rung 2's. Title differs (A vs B), so
    // the true-duplicate tiebreak must NOT apply: this stays a genuine tie, falling to rung 4.
    const r = resolveGraph("height mass scatterplot", [older, newer], null);
    if (r.ok) throw new Error("title differs between candidates, so this is NOT a true duplicate — should fail");
    expect(r.error).toContain('"A" (scatterplot of Height vs Mass)');
    expect(r.error).toContain('"B" (scatterplot of Height vs Mass)');
  });

  it("rung 3: candidates identical in every tiebreak field (including title) resolve to the highest id", () => {
    const older = {
      id: 5, title: "Height vs Mass", name: "g-older", plotType: "scatterPlot",
      xAttributeName: "Height", yAttributeName: "Mass", dataContext: "Mammals",
    };
    const newer = {
      id: 8, title: "Height vs Mass", name: "g-newer", plotType: "scatterPlot",
      xAttributeName: "Height", yAttributeName: "Mass", dataContext: "Mammals",
    };
    // Title normalizes identically for both ("height vs mass"), so rung 2 sees a tie there too —
    // either rung would need to reach the same newest-wins answer; drive it through rung 3's
    // path with a phrase that doesn't title-match to be sure rung 3's own tiebreak fires.
    const r = resolveGraph("the mass height scatterplot", [older, newer], null);
    if (!r.ok) throw new Error(`should succeed, got error: ${r.error}`);
    expect(r.value.id).toBe(8);
    expect(r.repaired).toBe(true);
  });

  it("near-duplicates (same title, different axes) are NOT collapsed by the tiebreak — rung 4 descriptive", () => {
    const g1 = { id: 5, title: "Height", name: "g1", plotType: "dotPlot", xAttributeName: "Height", dataContext: "Mammals" };
    const g2 = { id: 8, title: "Height", name: "g2", plotType: "scatterPlot", xAttributeName: "Height", yAttributeName: "Mass", dataContext: "Mammals" };
    const r = resolveGraph("height", [g1, g2], null);
    if (r.ok) throw new Error("differing plotType/axes must NOT be treated as a true duplicate — should fail");
    expect(r.error).toContain("dot plot of Height");
    expect(r.error).toContain("scatterplot of Height vs Mass");
  });
});

describe("resolveGraph rung 4: descriptive corrective (DAVAI-126)", () => {
  const heightDotPlot = { id: 10, title: "Height", name: "graph10", xAttributeName: "Height" };
  const heightVsMass = {
    id: 20, title: "Height vs Mass", name: "graph20", xAttributeName: "Height", yAttributeName: "Mass",
  };

  it("no match: lists all graphs with shape descriptions and a worked example", () => {
    const graphs = [heightDotPlot, heightVsMass];
    const r = resolveGraph("heights", graphs, null);
    if (r.ok) throw new Error("should fail");
    expect(r.error).toContain('"Height" (dot plot of Height)');
    expect(r.error).toContain('"Height vs Mass" (scatterplot of Height vs Mass)');
    expect(r.error).toMatch(/name one/i);
    expect(r.error).toContain("the Height dot plot");
  });

  it("no-selection empty request uses the same descriptive listing and reveals true duplicates " +
    "(no longer deduped away)", () => {
    // Two graphs both titled "Height" — the old graphTitlesForDisplay path deduped this down to
    // one entry, hiding the collision. The descriptive listing must show both.
    const g1 = { id: 1, title: "Height", name: "g1", xAttributeName: "Height" };
    const g2 = { id: 2, title: "Height", name: "g2", xAttributeName: "Height", yAttributeName: "Mass" };
    const r = resolveGraph(undefined, [g1, g2], null);
    if (r.ok) throw new Error("should fail");
    expect(r.error).toMatch(/no graph is selected/i);
    // Both must appear — distinguished by shape since titles collide.
    expect(r.error).toContain("dot plot of Height");
    expect(r.error).toContain("scatterplot of Height vs Mass");
  });

  it("zero-graphs message is unchanged by the rung-4 rework", () => {
    const r = resolveGraph(undefined, [], null);
    if (r.ok) throw new Error("should fail");
    expect(r.error).toMatch(/no graphs in this document/i);
    expect(r.error).toContain("create_graph");
  });

  it("caps listings at 6 candidates plus an ellipsis", () => {
    const graphs = Array.from({ length: 8 }, (_, i) => ({
      id: i + 1, title: `Plot${i}`, name: `g${i}`, xAttributeName: `Attr${i}`,
    }));
    const r = resolveGraph("nonexistent-name", graphs, null);
    if (r.ok) throw new Error("should fail");
    expect(r.error).toContain("Plot0");
    expect(r.error).toContain("Plot5");
    expect(r.error).not.toContain("Plot6");
    expect(r.error).toContain("…");
  });

  it("CLOSURE PROPERTY: a rung-4-suggested phrasing round-trips through rung 3 to a unique hit", () => {
    // This is the point of the design: whatever we tell the user to say must actually work.
    const graphs = [heightDotPlot, heightVsMass];
    const failed = resolveGraph("heights", graphs, null);
    if (failed.ok) throw new Error("setup should fail to produce a rung-4 message");
    const match = failed.error.match(/e\.g\. "([^"]+)"/);
    if (!match) throw new Error(`expected a quoted example phrase in: ${failed.error}`);
    const suggestion = match[1];
    const retried = resolveGraph(suggestion, graphs, null);
    if (!retried.ok) throw new Error(`suggested phrase "${suggestion}" did not resolve: ${retried.error}`);
    expect(retried.value.id).toBe(10);
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
