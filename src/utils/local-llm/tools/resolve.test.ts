import {
  normalizeName, resolveByName, resolveDataContext, resolveCollection, resolveCollectionDefaultLeaf,
  resolveAttribute, resolveGraph, extractBacktickRefs, listNames, describeGraphOption, graphLabel
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

  // PR #114 review item 11: `.trim()` runs BEFORE the separator-collapse replace, so a LEADING
  // (or trailing) underscore/hyphen — not whitespace, so .trim() doesn't touch it — collapses
  // into a leading/trailing SPACE that survives uncollapsed, breaking the normalized-match repair
  // against a differently-formatted name with no such leading space.
  it("re-trims after collapsing separators, so a leading/trailing underscore doesn't survive as " +
    "a leading/trailing space (PR #114 review item 11)", () => {
    expect(normalizeName("_sleep_hours")).toBe("sleep hours");
    expect(normalizeName("sleep_hours_")).toBe("sleep hours");
    expect(normalizeName("-sleep-hours-")).toBe("sleep hours");
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
  // PR #114 review item 8: resolveDataContext had no sole-context default, unlike
  // resolveCollection above — an omitted dataContext in a single-dataset document bounced with
  // "Unknown data context \"\"" instead of resolving silently, forcing an avoidable round trip.
  describe("resolveDataContext sole-context default (PR #114 review item 8)", () => {
    it("an omitted (undefined) dataContext resolves to the only one, not repaired", () => {
      const r = resolveDataContext(undefined, dcs);
      if (!r.ok) throw new Error(`should succeed, got error: ${r.error}`);
      expect(r.value.name).toBe("Mammals");
      expect(r.repaired).toBe(false);
    });

    it("an omitted (empty-string) dataContext resolves to the only one too — tool call sites " +
      "pass String(args.dataContext ?? \"\"), so \"\" is the common omitted shape", () => {
        const r = resolveDataContext("", dcs);
        if (!r.ok) throw new Error(`should succeed, got error: ${r.error}`);
        expect(r.value.name).toBe("Mammals");
    });

    it("a multi-context document keeps today's corrective when dataContext is omitted", () => {
      const multiDcs = { Mammals: dc, Birds: { name: "Birds", collections: [] } };
      const r = resolveDataContext(undefined, multiDcs);
      if (r.ok) throw new Error("should fail — ambiguous across two data contexts");
      expect(r.error).toMatch(/unknown data context/i);
    });

    it("an explicitly-named dataContext still resolves normally in a multi-context document " +
      "(the default only engages when nothing was named)", () => {
      const multiDcs = { Mammals: dc, Birds: { name: "Birds", collections: [] } };
      const r = resolveDataContext("birds", multiDcs);
      if (!r.ok) throw new Error(`should succeed, got error: ${r.error}`);
      expect(r.value.name).toBe("Birds");
      expect(r.repaired).toBe(true);
    });
  });
  // DAVAI-126 Task D fix pass: leaf-collection default (opt-in variant used by find_cases).
  // Collections are stored parent-first (see resolve.ts's helper comment for the evidence chain),
  // so "leaf/childmost" = LAST element — the collection that still holds the lookup attributes
  // after a group_by moves one attribute into a new parent collection.
  it("resolveCollectionDefaultLeaf: unspecified defaults to the LAST (childmost/leaf) collection " +
    "in multi-collection contexts; single-collection and explicit-name behavior delegate unchanged", () => {
    const multi = { name: "M", collections: [{ name: "Diet", attrs: [] }, { name: "Cases", attrs: [] }] };
    const leaf = resolveCollectionDefaultLeaf(undefined, multi);
    if (!leaf.ok) throw new Error("should succeed");
    expect(leaf.value.name).toBe("Cases");
    const single = resolveCollectionDefaultLeaf(undefined, dc);
    if (!single.ok) throw new Error("should succeed");
    expect(single.value.name).toBe("Cases");
    const explicitParent = resolveCollectionDefaultLeaf("diet", multi); // rung-2 repair, parent OK
    if (!explicitParent.ok) throw new Error("should succeed");
    expect(explicitParent.value.name).toBe("Diet");
    const unknown = resolveCollectionDefaultLeaf("Bogus", multi);
    if (unknown.ok) throw new Error("should fail");
    expect(unknown.error).toMatch(/unknown collection/i);
  });
  it("resolveCollectionDefaultLeaf: zero collections is a corrective, not a crash", () => {
    const empty = { name: "E", collections: [] };
    const r = resolveCollectionDefaultLeaf(undefined, empty);
    if (r.ok) throw new Error("should fail");
    expect(r.error).toMatch(/no collections/i);
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

// DAVAI-126 matrix round 3 item E2: rung 0 — an exact numeric-id reference (e.g. echoed back from
// a seed header that historically printed a bare id) must resolve, even though we never PRINT
// bare ids as the primary label anymore (E1). Evidence: the model faithfully copied
// `885090985993956` from the seed into get_graph_info/sonify calls and the resolver rejected it,
// causing a 5-call flail. Rung 0 runs BEFORE rung 1 (title/name matching).
describe("resolveGraph rung 0: exact numeric id (DAVAI-126 matrix round 3 E2)", () => {
  it("an exact string-equal-to-id request resolves, not repaired (it IS an exact reference)", () => {
    const graphs = [{ id: 885090985993956, title: "Heights" }];
    const r = resolveGraph("885090985993956", graphs, null);
    if (!r.ok) throw new Error(`should succeed, got error: ${r.error}`);
    expect(r.value.id).toBe(885090985993956);
    expect(r.repaired).toBe(false);
  });

  it("leading/trailing whitespace around the id is trimmed before comparison", () => {
    const graphs = [{ id: 42, title: "Heights" }];
    const r = resolveGraph("  42  ", graphs, null);
    if (!r.ok) throw new Error(`should succeed, got error: ${r.error}`);
    expect(r.value.id).toBe(42);
    expect(r.repaired).toBe(false);
  });

  it("id matching takes priority over a coincidental title/name match (rung 0 before rung 1)", () => {
    // Contrived: a graph's title happens to be the string form of a DIFFERENT graph's id.
    const target = { id: 42, title: "Heights" };
    const decoy = { id: 99, title: "42" };
    const r = resolveGraph("42", [decoy, target], null);
    if (!r.ok) throw new Error(`should succeed, got error: ${r.error}`);
    expect(r.value.id).toBe(42);
  });

  it("a non-numeric string that happens to equal no id falls through to the rest of the ladder " +
    "unaffected (no false positive)", () => {
    const graphs = [{ id: 42, title: "Heights" }];
    const r = resolveGraph("Heights", graphs, null);
    if (!r.ok) throw new Error(`should succeed, got error: ${r.error}`);
    expect(r.value.id).toBe(42);
    expect(r.repaired).toBe(false); // still an exact title match via rung 1, untouched by rung 0
  });

  it("a request matching no graph's id and no other rung still produces the normal rung-4 corrective", () => {
    const graphs = [{ id: 42, title: "Heights" }];
    const r = resolveGraph("999999", graphs, null);
    if (r.ok) throw new Error("should fail");
    expect(r.error).toMatch(/no graph matches/i);
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

// DAVAI-126 matrix round 3 item E3: a genuine rung-3 scoring tie between two graphs that are
// axis-swapped mirror images of each other (x=Height,y=Mass vs x=Mass,y=Height) — both score
// identically against "height vs mass" since scoring is substring containment, order-agnostic.
// Evidence (4B/think): request "Height vs Mass" tied and forced an unnecessary rung-4 ask, even
// though the request's OWN word order ("A vs B") unambiguously picks the x=A,y=B graph over the
// x=B,y=A one. This tiebreak runs AFTER the true-duplicate tiebreak (which only fires for
// content-identical graphs — these two are NOT identical, their axes are swapped) and BEFORE
// falling to rung 4.
describe("resolveGraph rung 3 word-order tiebreak (DAVAI-126 matrix round 3 E3)", () => {
  const heightVsMass = { id: 1, title: "", xAttributeName: "Height", yAttributeName: "Mass" };
  const massVsHeight = { id: 2, title: "", xAttributeName: "Mass", yAttributeName: "Height" };

  it("the exact 4B/think scenario: \"Height vs Mass\" picks the x=Height,y=Mass graph, repaired", () => {
    const r = resolveGraph("Height vs Mass", [heightVsMass, massVsHeight], null);
    if (!r.ok) throw new Error(`should succeed, got error: ${r.error}`);
    expect(r.value.id).toBe(1);
    expect(r.repaired).toBe(true);
  });

  it("reversed request (\"Mass vs Height\") picks the OTHER graph", () => {
    const r = resolveGraph("Mass vs Height", [heightVsMass, massVsHeight], null);
    if (!r.ok) throw new Error(`should succeed, got error: ${r.error}`);
    expect(r.value.id).toBe(2);
    expect(r.repaired).toBe(true);
  });

  it("\"versus\" (spelled out) works the same as \"vs\"", () => {
    const r = resolveGraph("Height versus Mass", [heightVsMass, massVsHeight], null);
    if (!r.ok) throw new Error(`should succeed, got error: ${r.error}`);
    expect(r.value.id).toBe(1);
    expect(r.repaired).toBe(true);
  });

  it("word-order matching is case/normalization-insensitive (miscapitalized attribute names)", () => {
    const r = resolveGraph("height VS mass", [heightVsMass, massVsHeight], null);
    if (!r.ok) throw new Error(`should succeed, got error: ${r.error}`);
    expect(r.value.id).toBe(1);
  });

  it("a tie with NO \"vs\"/\"versus\" phrasing in the request is unaffected — still falls to rung 4", () => {
    // Neither "vs" nor "versus" appears, so the word-order tiebreak must not engage at all —
    // existing tie behavior (rung 4 descriptive) applies exactly as before this fix.
    const r = resolveGraph("height mass", [heightVsMass, massVsHeight], null);
    if (r.ok) throw new Error("should fail — no vs/versus phrasing, so no tiebreak should apply");
    expect(r.error).toMatch(/no graph matches/i);
  });

  it("a \"vs\" tie where NEITHER tied graph's axes match the request's word order falls to rung 4 " +
    "(the tiebreak only fires when EXACTLY ONE candidate matches that specific order)", () => {
    // Both graphs share the same x/y pair (not swapped), so a "vs" phrase naming a THIRD pair of
    // attributes cannot match either graph's axes in the stated order — the tiebreak condition
    // ("exactly one tied graph has normalized xAttributeName matching A and yAttributeName
    // matching B") is never satisfied, so this must remain a genuine tie.
    const dup1 = { id: 3, title: "", xAttributeName: "Height", yAttributeName: "Mass" };
    const dup2 = { id: 4, title: "", xAttributeName: "Height", yAttributeName: "Mass", dataContext: "Other" };
    const r = resolveGraph("Sleep vs Age", [dup1, dup2], null);
    if (r.ok) throw new Error("should fail — the vs-phrase names attributes neither graph uses as its own x/y pair");
    // (This particular request wouldn't even score >0 against these graphs' axis names, so it's
    // actually a rung-3 MISS, not a tie — included to document the tiebreak is scoped to real ties.)
    expect(r.error).toMatch(/no graph matches/i);
  });

  it("does not apply the word-order tiebreak to a true-duplicate tie (identical axes both ways) " +
    "— the true-duplicate (newest-wins) tiebreak still takes precedence", () => {
    // Two graphs with the SAME x/y pair (not swapped) tie on "height vs mass" — this is a
    // true-duplicate case (content-identical), which the EXISTING tiebreak (newest wins) already
    // resolves before the word-order tiebreak would even be considered.
    const older = { id: 5, title: "Height vs Mass", plotType: "scatterPlot", xAttributeName: "Height", yAttributeName: "Mass", dataContext: "M" };
    const newer = { id: 6, title: "Height vs Mass", plotType: "scatterPlot", xAttributeName: "Height", yAttributeName: "Mass", dataContext: "M" };
    // Use a phrase that doesn't title-match so rung 3 (not rung 2) does the resolving.
    const r = resolveGraph("the mass height scatterplot", [older, newer], null);
    if (!r.ok) throw new Error(`should succeed, got error: ${r.error}`);
    expect(r.value.id).toBe(6); // newest wins, same as before this fix
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

describe("resolveGraph rung 3/4: plotType-driven shape words (DAVAI-126 review fix)", () => {
  // Real runtime plotType values, confirmed against graph-sonification-utils.ts (isDotPlot check,
  // isUnsplitScatterPlot) and graph-sonification-model.test.ts's barChart fixture — NOT guessed.
  it("describeGraphOption labels a barChart as \"bar chart\", not \"dot plot\", even with only one axis set", () => {
    const barChart = { id: 1, title: "Species", name: "g1", plotType: "barChart", xAttributeName: "Species" };
    expect(describeGraphOption(barChart)).toBe('"Species" (bar chart of Species)');
  });

  it("describeGraphOption labels dotPlot as \"dot plot\" and scatterPlot as \"scatterplot\" when plotType is present", () => {
    const dotPlot = { id: 1, title: "Height", name: "g1", plotType: "dotPlot", xAttributeName: "Height" };
    const scatter = {
      id: 2, title: "Height vs Mass", name: "g2", plotType: "scatterPlot",
      xAttributeName: "Height", yAttributeName: "Mass",
    };
    expect(describeGraphOption(dotPlot)).toBe('"Height" (dot plot of Height)');
    expect(describeGraphOption(scatter)).toBe('"Height vs Mass" (scatterplot of Height vs Mass)');
  });

  it("describeGraphOption falls back to a generic \"graph\" shape for an unrecognized plotType", () => {
    const pieChart = { id: 1, title: "Habitat", name: "g1", plotType: "pieChart", xAttributeName: "Habitat" };
    expect(describeGraphOption(pieChart)).toBe('"Habitat" (graph of Habitat)');
  });

  it("a barChart is excluded from the \"dot plot\"-filtered rung 3 bucket even though it has exactly " +
    "one axis populated — a real dotPlot with the same axis wins instead", () => {
    const barChart = { id: 1, title: "Species", name: "g1", plotType: "barChart", xAttributeName: "Species" };
    const dotPlot = { id: 2, title: "Species", name: "g2", plotType: "dotPlot", xAttributeName: "Species" };
    const r = resolveGraph("species dot plot", [barChart, dotPlot], null);
    if (!r.ok) throw new Error(`should succeed, got error: ${r.error}`);
    expect(r.value.id).toBe(2);
  });

  it("a barChart alone does not satisfy a \"dot plot\" request — filter eliminates it, falls to rung 4", () => {
    const barChart = { id: 1, title: "Species", name: "g1", plotType: "barChart", xAttributeName: "Species" };
    const r = resolveGraph("species dot plot", [barChart], null);
    if (r.ok) throw new Error("a barChart must NOT match a \"dot plot\" request — should fail");
    expect(r.error).toMatch(/no graph matches/i);
  });

  it("a barChart with both x and y populated is not swept into the scatterplot filter either", () => {
    const barChart = {
      id: 1, title: "Species Counts", name: "g1", plotType: "barChart",
      xAttributeName: "Species", yAttributeName: "Count",
    };
    const scatter = {
      id: 2, title: "Species vs Count", name: "g2", plotType: "scatterPlot",
      xAttributeName: "Species", yAttributeName: "Count",
    };
    const r = resolveGraph("species count scatterplot", [barChart, scatter], null);
    if (!r.ok) throw new Error(`should succeed, got error: ${r.error}`);
    expect(r.value.id).toBe(2);
  });

  it("plotType undefined falls back to the axis-presence heuristic exactly as before (legitimate " +
    "absence — plotType is types.maybe on the model)", () => {
    const noPlotType = { id: 1, title: "Height", name: "g1", xAttributeName: "Height" };
    expect(describeGraphOption(noPlotType)).toBe('"Height" (dot plot of Height)');
    const withPlotType = { id: 2, title: "Height vs Mass", name: "g2", xAttributeName: "Height", yAttributeName: "Mass" };
    expect(describeGraphOption(withPlotType)).toBe('"Height vs Mass" (scatterplot of Height vs Mass)');
  });

  it("plotType undefined still lets a \"dot plot\" request match a single-axis graph via the axis-" +
    "presence filter fallback", () => {
    const singleAxis = { id: 1, title: "Height", name: "g1", xAttributeName: "Height" };
    const bothAxes = { id: 2, title: "Height vs Mass", name: "g2", xAttributeName: "Height", yAttributeName: "Mass" };
    const r = resolveGraph("height dot plot", [singleAxis, bothAxes], null);
    if (!r.ok) throw new Error(`should succeed, got error: ${r.error}`);
    expect(r.value.id).toBe(1);
  });

  it("describeGraphOption labels a binnedDotPlot as \"dot plot\" — same dot-plot family as " +
    "graph-sonification-utils' isUnivariateDotPlot (dotPlot || binnedDotPlot)", () => {
    const binned = { id: 1, title: "Height", name: "g1", plotType: "binnedDotPlot", xAttributeName: "Height" };
    expect(describeGraphOption(binned)).toBe('"Height" (dot plot of Height)');
  });

  it("a binnedDotPlot wins a \"height dot plot\" rung-3 request over a scatterplot", () => {
    const binned = { id: 1, title: "Height", name: "g1", plotType: "binnedDotPlot", xAttributeName: "Height" };
    const scatter = {
      id: 2, title: "Height vs Mass", name: "g2", plotType: "scatterPlot",
      xAttributeName: "Height", yAttributeName: "Mass",
    };
    const r = resolveGraph("height dot plot", [binned, scatter], null);
    if (!r.ok) throw new Error(`should succeed, got error: ${r.error}`);
    expect(r.value.id).toBe(1);
  });

  it("CLOSURE PROPERTY still holds for a barChart candidate: its rung-4 example phrase says " +
    "\"bar chart\" (not \"dot plot\") and round-trips through rung 3 to itself", () => {
    const barChart = { id: 1, title: "Species", name: "g1", plotType: "barChart", xAttributeName: "Species" };
    const failed = resolveGraph("nonexistent", [barChart], null);
    if (failed.ok) throw new Error("setup should fail to produce a rung-4 message");
    expect(failed.error).toContain('"Species" (bar chart of Species)');
    const match = failed.error.match(/e\.g\. "([^"]+)"/);
    if (!match) throw new Error(`expected a quoted example phrase in: ${failed.error}`);
    const suggestion = match[1];
    expect(suggestion).toContain("bar chart");
    expect(suggestion).not.toContain("dot plot");
    const retried = resolveGraph(suggestion, [barChart], null);
    if (!retried.ok) throw new Error(`suggested phrase "${suggestion}" did not resolve: ${retried.error}`);
    expect(retried.value.id).toBe(1);
  });
});

// PR #114 review Gate 2: `resolveGraph` (and its sibling resolvers) called `.trim()` on
// `requested` unconditionally. Callers type it `args.graph as string`, a compile-time-only cast —
// when the model echoes a printed numeric id back as an unquoted JSON number, `args.graph` is a
// runtime `number`, and `.trim()` throws `TypeError: requested.trim is not a function`, which
// dispatchTool then surfaced as a misleading, non-corrective internal-error string. Root-cause fix
// per the reviewer: coerce `String(requested)` at the boundary (only when defined, so the
// undefined/"" defaulting semantics every resolver relies on are unchanged) rather than trusting
// every caller to coerce first.
describe("boundary coercion: a runtime number for `requested` never throws (PR #114 Gate 2)", () => {
  it("resolveGraph: a number-typed graph id resolves via rung 0 (exact id match), not a TypeError", () => {
    const graphs = [{ id: 885090985993956, title: "Heights" }];
    const r = resolveGraph(885090985993956 as unknown as string, graphs, null);
    if (!r.ok) throw new Error(`should succeed, got error: ${r.error}`);
    expect(r.value.id).toBe(885090985993956);
    expect(r.repaired).toBe(false);
  });

  it("resolveDataContext: a number-typed requested value hits the normal ladder (no match, " +
    "corrective error), never a TypeError", () => {
    const r = resolveDataContext(42 as unknown as string, dcs);
    if (r.ok) throw new Error("should fail — no data context named 42");
    expect(r.error).toMatch(/unknown data context/i);
  });

  it("resolveAttribute: a number-typed requested value hits the normal ladder, never a TypeError", () => {
    const r = resolveAttribute(42 as unknown as string, dc);
    if (r.ok) throw new Error("should fail — no attribute named 42");
    expect(r.error).toMatch(/unknown attribute/i);
  });

  it("resolveCollection: a number-typed requested value hits the normal ladder, never a TypeError", () => {
    const multi = { name: "M", collections: [{ name: "A", attrs: [] }, { name: "B", attrs: [] }] };
    const r = resolveCollection(42 as unknown as string, multi);
    if (r.ok) throw new Error("should fail — no collection named 42");
    expect(r.error).toMatch(/unknown collection/i);
  });

  it("resolveDataContext: a number that happens to match a data context's name still resolves " +
    "(coercion is genuinely useful, not just non-throwing)", () => {
    const numericDcs = { 42: { name: "42", collections: [] } };
    const r = resolveDataContext(42 as unknown as string, numericDcs);
    if (!r.ok) throw new Error(`should succeed, got error: ${r.error}`);
    expect(r.value.name).toBe("42");
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

// DAVAI-126 matrix round 3 item E1: a shared, RESOLVABLE graph label — every surface that prints
// a graph reference (seed header, tool results, correctives) uses this so a model echoing the
// label back always resolves. Fallback chain: non-empty title -> non-empty name -> descriptive
// phrase (reusing the rung-3 shape logic, e.g. "the Height dot plot") -> "graph <id>" when there
// are no axes to describe at all. Empty string is treated as absent at every tier (evidence:
// `Graphs: "" (dot plot of Height)` and `Added Mean adornment to "undefined"` in the live traces).
describe("graphLabel (DAVAI-126 matrix round 3 E1)", () => {
  it("non-empty title wins", () => {
    expect(graphLabel({ id: 1, title: "Heights", name: "graph1" })).toBe("Heights");
  });

  it("empty-string title is treated as ABSENT, not as a real (blank) label — falls through to name", () => {
    expect(graphLabel({ id: 1, title: "", name: "graph1" })).toBe("graph1");
  });

  it("empty-string title AND name falls all the way to the descriptive fallback", () => {
    expect(graphLabel({ id: 1, title: "", name: "", xAttributeName: "Height" })).toBe("the Height dot plot");
  });

  it("no title, non-empty name uses the name", () => {
    expect(graphLabel({ id: 1, name: "graph1", xAttributeName: "Height" })).toBe("graph1");
  });

  it("no title/name, univariate axes: descriptive fallback names the dot plot", () => {
    expect(graphLabel({ id: 1, xAttributeName: "Height" })).toBe("the Height dot plot");
  });

  it("no title/name, bivariate axes: descriptive fallback names the scatterplot with vs word order", () => {
    expect(graphLabel({ id: 1, xAttributeName: "Height", yAttributeName: "Mass" })).toBe("the Height vs Mass scatterplot");
  });

  it("no title/name/axes at all: falls back to a bare id reference", () => {
    expect(graphLabel({ id: 885090985993956 })).toBe("graph 885090985993956");
  });

  it("CLOSURE: every fallback tier's label round-trips through resolveGraph", () => {
    const titled = { id: 1, title: "Heights", name: "graph1", xAttributeName: "Height" };
    const namedOnly = { id: 2, name: "graph2", xAttributeName: "Mass" };
    const descriptiveDotPlot = { id: 3, xAttributeName: "Sleep" };
    const descriptiveScatter = { id: 4, xAttributeName: "Weight", yAttributeName: "Age" };
    const idOnly = { id: 5 };
    const graphs = [titled, namedOnly, descriptiveDotPlot, descriptiveScatter, idOnly];

    for (const g of graphs) {
      const label = graphLabel(g);
      const r = resolveGraph(label, graphs, null);
      if (!r.ok) throw new Error(`label "${label}" for graph id ${g.id} did not resolve: ${r.error}`);
      expect(r.value.id).toBe(g.id);
    }
  });
});
