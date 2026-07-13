jest.mock("../../codap-api-utils", () => ({ getAllCollectionCases: jest.fn() }));
import { getAllCollectionCases } from "../../codap-api-utils";
import { findCasesTool } from "./find-cases";
import { ILocalToolContext } from "./registry";

// Mirrors the real Mammals fixture (git-history-recovered caseFormulaSearch example): Mammal is
// the first categorical attribute, Sleep/Mass are numeric.
const dc = {
  name: "Mammals",
  collections: [{
    name: "Mammals",
    attrs: [{ name: "Mammal", type: "categorical" }, { name: "Sleep", type: "numeric" }, { name: "Mass", type: "numeric" }],
  }],
};
const send = jest.fn();
const ctx = { dataContexts: () => ({ Mammals: dc }), sendCODAPRequest: send } as unknown as ILocalToolContext;

// caseFormulaSearch's confirmed response shape (git-history-recovered doc, deleted commit
// 363e2aa1cd9f0ffef550b8044deb9fa252a7926b^:server/text/codap-api-documentation-full.md): a FLAT
// array of {id, parent, collection, values} — NOT allCases's {case: {values}} wrapper.
const searchCase = (id: number, values: Record<string, unknown>) => ({ id, parent: null, collection: { name: "Mammals", id: 3 }, values });

beforeEach(() => {
  jest.clearAllMocks();
  send.mockResolvedValue({
    success: true,
    values: [
      searchCase(1, { Mammal: "Big Brown Bat", Sleep: 19.9, Mass: 23 }),
      searchCase(2, { Mammal: "Little Brown Bat", Sleep: 19.9, Mass: 8 }),
      searchCase(3, { Mammal: "Giant Armadillo", Sleep: 18.1, Mass: 60000 }),
      searchCase(4, { Mammal: "Owl Monkey", Sleep: 17, Mass: 480 }),
    ],
  });
  (getAllCollectionCases as jest.Mock).mockResolvedValue([]);
});

// DAVAI-126 matrix round 3 item E6: 3 of 4 live matrix runs answered "which mammal is heaviest?"
// via get_case_values/get_stats instead of find_cases (misaligned/wrong-unit answers); only the
// run where find_cases happened to be salient used it, with a perfect one-call answer. The
// description gains the canonical phrasing naming that exact question, so models pattern-match
// the natural-language superlative to this tool.
it("description gains the canonical phrasing naming the heaviest-mammal question (DAVAI-126 matrix round 3 E6)", () => {
  expect(findCasesTool.description).toContain(
    "Find the top/bottom cases by an attribute or cases matching a condition — use for questions " +
    "like \"which mammal is the heaviest?\"."
  );
});

describe("validate", () => {
  it("requires at least one of where/orderBy, with a corrective example for each form", () => {
    const v = findCasesTool.validate({ dataContext: "Mammals" }, ctx);
    expect(v.ok).toBe(false);
    expect((v as any).error).toMatch(/where/i);
    expect((v as any).error).toMatch(/orderBy/i);
    // A worked example of each form, per brief.
    expect((v as any).error).toMatch(/`Sleep`|`Mass`/);
  });

  it("canonicalizes backticked refs in where (ladder rung 2 repair reaches CODAP)", () => {
    const v = findCasesTool.validate({ dataContext: "Mammals", where: "`sleep` > 12" }, ctx);
    expect(v.ok).toBe(true);
    expect((v as any).resolved.where).toBe("`Sleep` > 12");
  });

  it("rejects a where expression referencing an unknown attribute before any request", () => {
    const v = findCasesTool.validate({ dataContext: "Mammals", where: "`Speed` > 10" }, ctx);
    expect(v.ok).toBe(false);
    expect((v as any).error).toContain("Sleep");
    expect(send).not.toHaveBeenCalled();
  });

  it("resolves orderBy against the schema (ladder rung 2 repair)", () => {
    const v = findCasesTool.validate({ dataContext: "Mammals", orderBy: "mass" }, ctx);
    expect(v.ok).toBe(true);
    expect((v as any).resolved.orderBy).toBe("Mass");
  });

  it("rejects an unknown orderBy attribute", () => {
    const v = findCasesTool.validate({ dataContext: "Mammals", orderBy: "Speed" }, ctx);
    expect(v.ok).toBe(false);
    expect((v as any).error).toContain("Mass");
  });

  it("direction defaults to desc when orderBy is present", () => {
    const v = findCasesTool.validate({ dataContext: "Mammals", orderBy: "Mass" }, ctx);
    expect((v as any).resolved.direction).toBe("desc");
  });

  it("accepts direction asc", () => {
    const v = findCasesTool.validate({ dataContext: "Mammals", orderBy: "Mass", direction: "asc" }, ctx);
    expect((v as any).resolved.direction).toBe("asc");
  });

  it("limit defaults to 5", () => {
    const v = findCasesTool.validate({ dataContext: "Mammals", orderBy: "Mass" }, ctx);
    expect((v as any).resolved.limit).toBe(5);
  });

  it("limit is capped at 12", () => {
    const v = findCasesTool.validate({ dataContext: "Mammals", orderBy: "Mass", limit: 50 }, ctx);
    expect((v as any).resolved.limit).toBe(12);
  });

  it("both where and orderBy may be supplied together", () => {
    const v = findCasesTool.validate({ dataContext: "Mammals", where: "`Sleep` > 12", orderBy: "Mass" }, ctx);
    expect(v.ok).toBe(true);
    expect((v as any).resolved.where).toBe("`Sleep` > 12");
    expect((v as any).resolved.orderBy).toBe("Mass");
  });
});

describe("execute: where-form (CODAP formula engine)", () => {
  it("sends the documented caseFormulaSearch get request", async () => {
    const v = findCasesTool.validate({ dataContext: "Mammals", where: "`Sleep` > 12" }, ctx);
    await findCasesTool.execute((v as any).resolved, ctx);
    expect(send).toHaveBeenCalledWith({
      action: "get",
      resource: "dataContext[Mammals].collection[Mammals].caseFormulaSearch[`Sleep` > 12]",
    });
  });

  it("reports the count and case labels using the first categorical attribute, naming the " +
    "stat attribute only on the first row (brief's worked example)", async () => {
    const v = findCasesTool.validate({ dataContext: "Mammals", where: "`Sleep` > 12" }, ctx);
    const out = await findCasesTool.execute((v as any).resolved, ctx);
    expect(out).toBe(
      "Found 4 cases where Sleep > 12: Big Brown Bat (Sleep 19.9), Little Brown Bat (19.9), " +
      "Giant Armadillo (18.1), Owl Monkey (17)."
    );
  });

  it("zero matches produces the corrective wording with the total case count (no backticks in the sentence)", async () => {
    send.mockResolvedValueOnce({ success: true, values: [] });
    (getAllCollectionCases as jest.Mock).mockResolvedValue(Array.from({ length: 27 }, (_, i) => ({ case: { id: i } })));
    const v = findCasesTool.validate({ dataContext: "Mammals", where: "`Sleep` > 30" }, ctx);
    const out = await findCasesTool.execute((v as any).resolved, ctx);
    expect(out).toBe("No cases match Sleep > 30 — check the condition (27 cases total).");
  });

  it("uses case index as the label when the collection has no categorical attribute", async () => {
    const noCatDc = {
      name: "Mammals",
      collections: [{ name: "Mammals", attrs: [{ name: "Sleep", type: "numeric" }] }],
    };
    const noCatCtx = { dataContexts: () => ({ Mammals: noCatDc }), sendCODAPRequest: send } as unknown as ILocalToolContext;
    send.mockResolvedValueOnce({
      success: true,
      values: [searchCase(1, { Sleep: 19.9 }), searchCase(2, { Sleep: 18.1 })],
    });
    const v = findCasesTool.validate({ dataContext: "Mammals", where: "`Sleep` > 12" }, noCatCtx);
    const out = await findCasesTool.execute((v as any).resolved, noCatCtx);
    expect(out).toBe("Found 2 cases where Sleep > 12: Case 1 (Sleep 19.9), Case 2 (18.1).");
  });

  it("summarizes a CODAP failure using the documented top-level error shape", async () => {
    send.mockResolvedValue({ success: false, error: "bad formula" });
    const v = findCasesTool.validate({ dataContext: "Mammals", where: "`Sleep` >" }, ctx);
    const out = await findCasesTool.execute((v as any).resolved, ctx);
    expect(out).toMatch(/search failed/i);
    expect(out).toContain("bad formula");
  });

  it("falls back to values.error when the top-level error is absent (tolerance)", async () => {
    send.mockResolvedValue({ success: false, values: { error: "nested bad formula" } });
    const v = findCasesTool.validate({ dataContext: "Mammals", where: "`Sleep` >" }, ctx);
    const out = await findCasesTool.execute((v as any).resolved, ctx);
    expect(out).toMatch(/search failed/i);
    expect(out).toContain("nested bad formula");
  });
});

describe("execute: orderBy-form (client-side sort/slice)", () => {
  it("fetches all cases in the collection and sorts/slices by orderBy, defaulting desc + limit 5", async () => {
    (getAllCollectionCases as jest.Mock).mockResolvedValue([
      { case: { id: 1, values: { Mammal: "African Elephant", Mass: 6400 } } },
      { case: { id: 2, values: { Mammal: "Asian Elephant", Mass: 5000 } } },
      { case: { id: 3, values: { Mammal: "Hippopotamus", Mass: 4000 } } },
      { case: { id: 4, values: { Mammal: "Giraffe", Mass: 1200 } } },
      { case: { id: 5, values: { Mammal: "Gorilla", Mass: 175 } } },
      { case: { id: 6, values: { Mammal: "Human", Mass: 70 } } },
    ]);
    const v = findCasesTool.validate({ dataContext: "Mammals", orderBy: "Mass" }, ctx);
    const out = await findCasesTool.execute((v as any).resolved, ctx);
    expect(send).not.toHaveBeenCalled(); // orderBy-only never touches caseFormulaSearch
    expect(out).toBe(
      "Top 5 by Mass: African Elephant (6400), Asian Elephant (5000), Hippopotamus (4000), " +
      "Giraffe (1200), Gorilla (175) (of 6 cases)."
    );
  });

  it("respects an explicit limit and caps the reported total", async () => {
    (getAllCollectionCases as jest.Mock).mockResolvedValue([
      { case: { id: 1, values: { Mammal: "African Elephant", Mass: 6400 } } },
      { case: { id: 2, values: { Mammal: "Asian Elephant", Mass: 5000 } } },
      { case: { id: 3, values: { Mammal: "Hippopotamus", Mass: 4000 } } },
    ]);
    const v = findCasesTool.validate({ dataContext: "Mammals", orderBy: "Mass", limit: 3 }, ctx);
    const out = await findCasesTool.execute((v as any).resolved, ctx);
    expect(out).toBe("Top 3 by Mass: African Elephant (6400), Asian Elephant (5000), Hippopotamus (4000) (of 3 cases).");
  });

  it("ascending direction sorts smallest first", async () => {
    (getAllCollectionCases as jest.Mock).mockResolvedValue([
      { case: { id: 1, values: { Mammal: "African Elephant", Mass: 6400 } } },
      { case: { id: 2, values: { Mammal: "Human", Mass: 70 } } },
    ]);
    const v = findCasesTool.validate({ dataContext: "Mammals", orderBy: "Mass", direction: "asc" }, ctx);
    const out = await findCasesTool.execute((v as any).resolved, ctx);
    expect(out).toContain("Human (70), African Elephant (6400)");
  });

  it("non-numeric orderBy values sort last regardless of direction; blank/missing values omit " +
    "the parenthetical entirely rather than showing a numeric-formatted \"n/a\" (PR #114 review " +
    "item 6/11 — deliberately updated assertion: \"n/a\" read as MISSING to a listener about a " +
    "row that is, in fact, present)", async () => {
    (getAllCollectionCases as jest.Mock).mockResolvedValue([
      { case: { id: 1, values: { Mammal: "Elephant", Mass: 6400 } } },
      { case: { id: 2, values: { Mammal: "Missing Data", Mass: "" } } },
      { case: { id: 3, values: { Mammal: "Bat", Mass: 20 } } },
      { case: { id: 4, values: { Mammal: "Also Missing", Mass: null } } },
    ]);
    const v = findCasesTool.validate({ dataContext: "Mammals", orderBy: "Mass" }, ctx);
    const out = await findCasesTool.execute((v as any).resolved, ctx);
    // Elephant (6400) then Bat (20) both numeric and properly desc-ordered; non-numeric last, in
    // original relative order. Only 4 candidates exist (below the default limit of 5), so the
    // header honestly reports "Top 4" (what's actually shown), not the requested limit.
    expect(out).toBe(
      "Top 4 by Mass: Elephant (6400), Bat (20), Missing Data, Also Missing (of 4 cases)."
    );
  });

  it("zero cases in the collection reports zero without dividing by zero or throwing", async () => {
    (getAllCollectionCases as jest.Mock).mockResolvedValue([]);
    const v = findCasesTool.validate({ dataContext: "Mammals", orderBy: "Mass" }, ctx);
    const out = await findCasesTool.execute((v as any).resolved, ctx);
    expect(out).toBe("No cases found in \"Mammals\" to order by Mass.");
  });

  // PR #114 review item 11: Number(" ") is a finite 0, so a whitespace-only value was counted
  // as a real numeric zero — sorting it among genuine zeros instead of last with the other
  // non-numeric/blank values, and displaying a fake "0" instead of omitting the parenthetical.
  it("treats a whitespace-only value as blank, not a numeric zero: sorts last and omits the " +
    "parenthetical (PR #114 review item 11)", async () => {
    (getAllCollectionCases as jest.Mock).mockResolvedValue([
      { case: { id: 1, values: { Mammal: "Elephant", Mass: 6400 } } },
      { case: { id: 2, values: { Mammal: "Whitespace Mass", Mass: "   " } } },
      { case: { id: 3, values: { Mammal: "Zero Mass", Mass: 0 } } },
    ]);
    const v = findCasesTool.validate({ dataContext: "Mammals", orderBy: "Mass" }, ctx);
    const out = await findCasesTool.execute((v as any).resolved, ctx);
    // A genuine numeric 0 sorts normally (last among numerics, desc); the whitespace-only value
    // sorts LAST of all (non-numeric bucket) and shows no parenthetical.
    expect(out).toBe("Top 3 by Mass: Elephant (6400), Zero Mass (0), Whitespace Mass (of 3 cases).");
  });
});

describe("hierarchy contexts after group_by (leaf-collection default; DAVAI-126 Task D fix pass)", () => {
  // Shaped exactly like the Mammals dataContext AFTER the battery's group-by-diet case runs:
  // group_by moved Diet into a new parent collection named "Diet" (collections are stored
  // parent-first; leaf/childmost is LAST), everything else stays in the childmost "Cases"
  // collection. Before this fix, find_cases hard-errored on ANY multi-collection context
  // ('"Mammals" has more than one collection — specify "collection"'), silently breaking the
  // existing find-heaviest eval case (last in the battery, after group-by-diet) and any real
  // user who groups then asks a lookup question.
  const hierDc = {
    name: "Mammals",
    collections: [
      { name: "Diet", attrs: [{ name: "Diet", type: "categorical" }] },
      {
        name: "Cases",
        attrs: [{ name: "Mammal", type: "categorical" }, { name: "Sleep", type: "numeric" }, { name: "Mass", type: "numeric" }],
      },
    ],
  };
  const hierCtx = { dataContexts: () => ({ Mammals: hierDc }), sendCODAPRequest: send } as unknown as ILocalToolContext;

  it("where-form defaults to the LEAF (childmost) collection instead of erroring", async () => {
    const v = findCasesTool.validate({ dataContext: "Mammals", where: "`Sleep` > 12" }, hierCtx);
    expect(v.ok).toBe(true);
    expect((v as any).resolved.collectionName).toBe("Cases");
    await findCasesTool.execute((v as any).resolved, hierCtx);
    expect(send).toHaveBeenCalledWith({
      action: "get",
      resource: "dataContext[Mammals].collection[Cases].caseFormulaSearch[`Sleep` > 12]",
    });
  });

  it("orderBy-form defaults to the leaf collection too (find-heaviest's exact post-group_by shape)", async () => {
    (getAllCollectionCases as jest.Mock).mockResolvedValue([
      { case: { id: 1, values: { Mammal: "African Elephant", Mass: 6400 } } },
      { case: { id: 2, values: { Mammal: "Human", Mass: 70 } } },
    ]);
    const v = findCasesTool.validate({ dataContext: "Mammals", orderBy: "Mass" }, hierCtx);
    expect(v.ok).toBe(true);
    const out = await findCasesTool.execute((v as any).resolved, hierCtx);
    expect(getAllCollectionCases).toHaveBeenCalledWith("Mammals", "Cases");
    expect(out).toContain("African Elephant (6400)");
  });

  it("a where ref to a PARENT attribute still canonicalizes while the search stays scoped to " +
    "the leaf (CODAP resolves parent refs from child formula contexts)", () => {
    const v = findCasesTool.validate({ dataContext: "Mammals", where: '`diet` == "meat"' }, hierCtx);
    expect(v.ok).toBe(true);
    expect((v as any).resolved.where).toBe('`Diet` == "meat"');
    expect((v as any).resolved.collectionName).toBe("Cases");
  });

  it("an explicit collection arg can target the PARENT collection", async () => {
    // Plain mockResolvedValue (not Once): the file's beforeEach re-establishes the base
    // implementation for every test, and an unconsumed once-value would leak into the next
    // test's send call (clearAllMocks clears calls, not queued once-implementations).
    send.mockResolvedValue({
      success: true,
      values: [{ id: 9, parent: null, collection: { name: "Diet", id: 5 }, values: { Diet: "meat" } }],
    });
    const v = findCasesTool.validate(
      { dataContext: "Mammals", collection: "Diet", where: '`Diet` == "meat"' }, hierCtx);
    expect(v.ok).toBe(true);
    expect((v as any).resolved.collectionName).toBe("Diet");
    const out = await findCasesTool.execute((v as any).resolved, hierCtx);
    expect(send).toHaveBeenCalledWith({
      action: "get",
      resource: 'dataContext[Mammals].collection[Diet].caseFormulaSearch[`Diet` == "meat"]',
    });
    expect(out).toContain("meat");
  });

  it("an explicit collection arg repairs case (ladder rung 2) and rejects unknown names with " +
    "the existing corrective listing real collections", () => {
    const repaired = findCasesTool.validate({ dataContext: "Mammals", collection: "cases", orderBy: "Mass" }, hierCtx);
    expect(repaired.ok).toBe(true);
    expect((repaired as any).resolved.collectionName).toBe("Cases");
    const unknown = findCasesTool.validate({ dataContext: "Mammals", collection: "Bogus", orderBy: "Mass" }, hierCtx);
    expect(unknown.ok).toBe(false);
    expect((unknown as any).error).toMatch(/unknown collection/i);
    expect((unknown as any).error).toContain("Cases");
  });
});

describe("execute: both-form (where narrows, then orderBy sorts/slices the matches)", () => {
  it("applies where via caseFormulaSearch, then sorts/slices that result set by orderBy", async () => {
    send.mockResolvedValueOnce({
      success: true,
      values: [
        searchCase(1, { Mammal: "Big Brown Bat", Sleep: 19.9, Mass: 23 }),
        searchCase(3, { Mammal: "Giant Armadillo", Sleep: 18.1, Mass: 60000 }),
        searchCase(4, { Mammal: "Owl Monkey", Sleep: 17, Mass: 480 }),
      ],
    });
    const v = findCasesTool.validate({ dataContext: "Mammals", where: "`Sleep` > 12", orderBy: "Mass" }, ctx);
    const out = await findCasesTool.execute((v as any).resolved, ctx);
    expect(send).toHaveBeenCalledWith({
      action: "get",
      resource: "dataContext[Mammals].collection[Mammals].caseFormulaSearch[`Sleep` > 12]",
    });
    expect(out).toBe("Top 3 by Mass where Sleep > 12: Giant Armadillo (60000), Owl Monkey (480), Big Brown Bat (23) (of 3 cases).");
  });

  it("zero matches from where short-circuits before any orderBy sort (reuses the where zero-match wording)", async () => {
    send.mockResolvedValueOnce({ success: true, values: [] });
    (getAllCollectionCases as jest.Mock).mockResolvedValue(Array.from({ length: 27 }, () => ({ case: { id: 1 } })));
    const v = findCasesTool.validate({ dataContext: "Mammals", where: "`Sleep` > 30", orderBy: "Mass" }, ctx);
    const out = await findCasesTool.execute((v as any).resolved, ctx);
    expect(out).toBe("No cases match Sleep > 30 — check the condition (27 cases total).");
  });
});

// PR #114 review item 6: the where/orderBy stat attribute's value display ran numeric-only
// formatValue on EVERY stat value, so a categorical attribute (e.g. Diet) printed the
// numeric-formatted "n/a" for a value that IS present — "n/a" reads as MISSING to a listener,
// not "not a number". Fixed to print the raw string for a non-numeric-but-present value, and to
// omit the parenthetical entirely (not "n/a") for a genuinely blank/missing one.
describe("categorical stat values (PR #114 review item 6)", () => {
  const catDc = {
    name: "Mammals",
    collections: [{
      name: "Mammals",
      attrs: [
        { name: "Mammal", type: "categorical" }, { name: "Diet", type: "categorical" },
        { name: "Sleep", type: "numeric" },
      ],
    }],
  };
  const catCtx = { dataContexts: () => ({ Mammals: catDc }), sendCODAPRequest: send } as unknown as ILocalToolContext;

  it("prints the raw string value for a categorical WHERE stat attribute instead of a numeric-" +
    "formatted \"n/a\"", async () => {
    send.mockResolvedValueOnce({
      success: true,
      values: [
        searchCase(1, { Mammal: "Lion", Diet: "meat", Sleep: 13.5 }),
        searchCase(2, { Mammal: "Tiger", Diet: "meat", Sleep: 15.8 }),
      ],
    });
    const v = findCasesTool.validate({ dataContext: "Mammals", where: "`Diet` == \"meat\"" }, catCtx);
    const out = await findCasesTool.execute((v as any).resolved, catCtx);
    expect(out).toBe('Found 2 cases where Diet == "meat": Lion (Diet meat), Tiger (meat).');
  });

  it("prints the raw string value for a categorical ORDERBY attribute (non-numeric values still " +
    "sort last per the existing contract, unchanged — here EVERY value is non-numeric, so " +
    "original relative order is preserved)", async () => {
    (getAllCollectionCases as jest.Mock).mockResolvedValue([
      { case: { id: 1, values: { Mammal: "Lion", Diet: "meat" } } },
      { case: { id: 2, values: { Mammal: "Elephant", Diet: "plants" } } },
    ]);
    const v = findCasesTool.validate({ dataContext: "Mammals", orderBy: "Diet" }, catCtx);
    const out = await findCasesTool.execute((v as any).resolved, catCtx);
    expect(out).toBe("Top 2 by Diet: Lion (meat), Elephant (plants) (of 2 cases).");
  });

  it("omits the parenthetical (never \"n/a\") for a blank/missing categorical stat value", async () => {
    send.mockResolvedValueOnce({
      success: true,
      values: [
        searchCase(1, { Mammal: "Lion", Diet: "meat" }),
        searchCase(2, { Mammal: "Unknown Diet Animal", Diet: "" }),
      ],
    });
    // The stat attribute comes from the where expression's OWN backticked ref (existing
    // contract) — reference Diet there so its blank second value is what's under test.
    const v = findCasesTool.validate({ dataContext: "Mammals", where: '`Diet` != ""' }, catCtx);
    const out = await findCasesTool.execute((v as any).resolved, catCtx);
    expect(out).toBe('Found 2 cases where Diet != "": Lion (Diet meat), Unknown Diet Animal.');
  });
});

// PR #114 review item 6 (consistency note): findLabelAttribute trusted schema `attr.type ===
// "categorical"` alone, even though get-stats.ts documents that `type` is unreliable in real
// documents and value-sniffs instead. Aligns the label-attribute stance with that same
// value-sniffing rather than trusting attr.type.
describe("label attribute selection value-sniffs case data instead of trusting attr.type alone " +
  "(PR #114 review item 6 consistency note)", () => {
  it("picks a schema-categorical-typed attribute whose ACTUAL values are non-numeric, same as " +
    "before, when attr.type happens to agree with the data", async () => {
    (getAllCollectionCases as jest.Mock).mockResolvedValue([
      { case: { id: 1, values: { Mammal: "African Elephant", Mass: 6400 } } },
      { case: { id: 2, values: { Mammal: "Human", Mass: 70 } } },
    ]);
    const v = findCasesTool.validate({ dataContext: "Mammals", orderBy: "Mass" }, ctx);
    const out = await findCasesTool.execute((v as any).resolved, ctx);
    expect(out).toContain("African Elephant (6400)");
  });

  it("falls back to a case-index label when the collection's ONLY attrs value-sniff as numeric, " +
    "even if schema metadata mislabels one as categorical", async () => {
    const mislabeledDc = {
      name: "Mammals",
      collections: [{
        name: "Mammals",
        // Schema claims "Code" is categorical, but its real values are all numeric — value-
        // sniffing (not attr.type) must decide, so no attribute here qualifies as a label.
        attrs: [{ name: "Code", type: "categorical" }, { name: "Sleep", type: "numeric" }],
      }],
    };
    const mislabeledCtx = { dataContexts: () => ({ Mammals: mislabeledDc }), sendCODAPRequest: send } as unknown as ILocalToolContext;
    send.mockResolvedValueOnce({
      success: true,
      values: [
        searchCase(1, { Code: "100", Sleep: 19.9 }),
        searchCase(2, { Code: "200", Sleep: 18.1 }),
      ],
    });
    const v = findCasesTool.validate({ dataContext: "Mammals", where: "`Sleep` > 12" }, mislabeledCtx);
    const out = await findCasesTool.execute((v as any).resolved, mislabeledCtx);
    expect(out).toBe("Found 2 cases where Sleep > 12: Case 1 (Sleep 19.9), Case 2 (18.1).");
  });
});
