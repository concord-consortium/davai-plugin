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

  it("non-numeric orderBy values sort last regardless of direction", async () => {
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
      "Top 4 by Mass: Elephant (6400), Bat (20), Missing Data (n/a), Also Missing (n/a) (of 4 cases)."
    );
  });

  it("zero cases in the collection reports zero without dividing by zero or throwing", async () => {
    (getAllCollectionCases as jest.Mock).mockResolvedValue([]);
    const v = findCasesTool.validate({ dataContext: "Mammals", orderBy: "Mass" }, ctx);
    const out = await findCasesTool.execute((v as any).resolved, ctx);
    expect(out).toBe("No cases found in \"Mammals\" to order by Mass.");
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
