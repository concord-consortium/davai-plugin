jest.mock("../../codap-api-utils", () => ({ getCollectionItemsForAttribute: jest.fn() }));
import { getCollectionItemsForAttribute } from "../../codap-api-utils";
import { groupByTool } from "./group-by";
import { ILocalToolContext } from "./registry";

// Single-collection Mammals fixture: Habitat lives in the only (necessarily childmost) collection.
const dc = {
  name: "Mammals",
  collections: [{
    name: "Mammals",
    attrs: [{ name: "Mammal", type: "categorical" }, { name: "Habitat", type: "categorical" }, { name: "Diet", type: "categorical" }],
  }],
};
const send = jest.fn();
const refreshDataContexts = jest.fn().mockResolvedValue(undefined);
const ctx = {
  dataContexts: () => ({ Mammals: dc }),
  sendCODAPRequest: send,
  refreshDataContexts,
} as unknown as ILocalToolContext;

const items = (values: string[]) => values.map((v, i) => ({ id: String(i), values: { Habitat: v } }));

beforeEach(() => {
  jest.clearAllMocks();
  send.mockResolvedValue({ success: true });
  (getCollectionItemsForAttribute as jest.Mock).mockResolvedValue(
    items(["land", "land", "water", "land", "both", "water", "land", "land"])
  );
});

describe("validate", () => {
  it("resolves dataContext and attribute (ladder rung 2 repair)", () => {
    const v = groupByTool.validate({ dataContext: "mammals", attribute: "habitat" }, ctx);
    expect(v.ok).toBe(true);
    expect((v as any).resolved.dataContextName).toBe("Mammals");
    expect((v as any).resolved.attributeName).toBe("Habitat");
  });

  it("rejects an unknown attribute before any request", () => {
    const v = groupByTool.validate({ dataContext: "Mammals", attribute: "Speed" }, ctx);
    expect(v.ok).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it("corrective when a collection named after the attribute already exists (exact-name " +
    "collision, distinct from the attribute's OWN collection membership)", () => {
    // A "Diet" collection already exists (e.g. left over from an earlier group_by), but the
    // Diet ATTRIBUTE currently being grouped still lives in the childmost "Mammals" collection —
    // isolates the exact-name-collision corrective from the parent-collection corrective below.
    const groupedDc = {
      name: "Mammals",
      collections: [
        { name: "Diet", attrs: [{ name: "SomeOtherAttr", type: "categorical" }] },
        { name: "Mammals", attrs: [{ name: "Mammal", type: "categorical" }, { name: "Diet", type: "categorical" }] },
      ],
    };
    const groupedCtx = { ...ctx, dataContexts: () => ({ Mammals: groupedDc }) } as unknown as ILocalToolContext;
    const v = groupByTool.validate({ dataContext: "Mammals", attribute: "Diet" }, groupedCtx);
    expect(v.ok).toBe(false);
    expect((v as any).error).toMatch(/already grouped/i);
    expect((v as any).error).toContain("Diet");
    expect(send).not.toHaveBeenCalled();
  });

  it("corrective when the attribute already lives in a parent (non-child) collection, named " +
    "DIFFERENTLY than the attribute (isolates this corrective from the exact-name-collision one)", () => {
    const alreadyParentDc = {
      name: "Mammals",
      collections: [
        { name: "ByHabitat", attrs: [{ name: "Habitat", type: "categorical" }] }, // parent (index 0)
        { name: "Mammals", attrs: [{ name: "Mammal", type: "categorical" }, { name: "Diet", type: "categorical" }] }, // child (index 1, last)
      ],
    };
    const parentCtx = { ...ctx, dataContexts: () => ({ Mammals: alreadyParentDc }) } as unknown as ILocalToolContext;
    const v = groupByTool.validate({ dataContext: "Mammals", attribute: "Habitat" }, parentCtx);
    expect(v.ok).toBe(false);
    expect((v as any).error).toMatch(/already grouped by habitat/i);
    expect((v as any).error).toContain("ByHabitat");
    expect(send).not.toHaveBeenCalled();
  });

  it("allows a numeric attribute (CODAP permits it)", () => {
    const v = groupByTool.validate({ dataContext: "Mammals", attribute: "Mammal" }, ctx);
    expect(v.ok).toBe(true);
  });
});

describe("execute: happy path (request sequence)", () => {
  it("sends collection-create then attributeLocation-update, in that order, using the " +
    "confirmed request shapes", async () => {
    const v = groupByTool.validate({ dataContext: "Mammals", attribute: "Habitat" }, ctx);
    await groupByTool.execute((v as any).resolved, ctx);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0][0]).toEqual({
      action: "create",
      resource: "dataContext[Mammals].collection",
      values: { name: "Habitat", title: "Habitat", parent: "_root_" },
    });
    expect(send.mock.calls[1][0]).toEqual({
      action: "update",
      resource: "dataContext[Mammals].collection[Mammals].attributeLocation[Habitat]",
      values: { collection: "Habitat", position: 0 },
    });
  });

  it("refreshes data contexts after success", async () => {
    const v = groupByTool.validate({ dataContext: "Mammals", attribute: "Habitat" }, ctx);
    await groupByTool.execute((v as any).resolved, ctx);
    expect(refreshDataContexts).toHaveBeenCalled();
  });

  it("reports grounded group counts computed client-side from already-fetched values", async () => {
    const v = groupByTool.validate({ dataContext: "Mammals", attribute: "Habitat" }, ctx);
    const out = await groupByTool.execute((v as any).resolved, ctx);
    expect(out).toBe('Grouped "Mammals" by Habitat — 3 groups: land (5 cases), water (2), both (1).');
  });

  it("caps the group listing at 8 groups plus a count of the rest", async () => {
    (getCollectionItemsForAttribute as jest.Mock).mockResolvedValue(
      items(["a", "a", "b", "c", "d", "e", "f", "g", "h", "i", "j"])
    );
    const v = groupByTool.validate({ dataContext: "Mammals", attribute: "Habitat" }, ctx);
    const out = await groupByTool.execute((v as any).resolved, ctx);
    // 10 distinct groups total; 8 shown + "and 2 more".
    expect(out).toContain("10 groups");
    expect(out).toContain("… and 2 more");
    const shownGroups = out.split(": ")[1].split("—")[0]; // not exact, just sanity below
    expect(shownGroups).toBeDefined();
    // Exactly 8 comma-joined group entries appear before the "and N more" tail.
    const listPart = out.split(": ").slice(1).join(": ").replace("… and 2 more.", "").trim().replace(/,$/, "");
    expect(listPart.split(", ").length).toBe(8);
  });

  it("numeric attribute with > 12 distinct values still succeeds but adds the categorical nudge", async () => {
    (getCollectionItemsForAttribute as jest.Mock).mockResolvedValue(
      items(Array.from({ length: 15 }, (_, i) => String(i)))
    );
    const v = groupByTool.validate({ dataContext: "Mammals", attribute: "Habitat" }, ctx);
    const out = await groupByTool.execute((v as any).resolved, ctx);
    expect(out).toMatch(/15 groups/);
    expect(out).toMatch(/categorical attribute usually works better/i);
  });

  it("does NOT add the categorical nudge at exactly 12 distinct values or fewer", async () => {
    (getCollectionItemsForAttribute as jest.Mock).mockResolvedValue(
      items(Array.from({ length: 12 }, (_, i) => String(i)))
    );
    const v = groupByTool.validate({ dataContext: "Mammals", attribute: "Habitat" }, ctx);
    const out = await groupByTool.execute((v as any).resolved, ctx);
    expect(out).not.toMatch(/categorical attribute usually works better/i);
  });
});

describe("execute: rollback on second-step failure", () => {
  it("attempts to delete the just-created empty collection when the attributeLocation move " +
    "fails, and reports the delete succeeded", async () => {
    send
      .mockResolvedValueOnce({ success: true }) // collection create
      .mockResolvedValueOnce({ success: false, error: "attribute not found" }) // attributeLocation move fails
      .mockResolvedValueOnce({ success: true }); // rollback delete succeeds
    const v = groupByTool.validate({ dataContext: "Mammals", attribute: "Habitat" }, ctx);
    const out = await groupByTool.execute((v as any).resolved, ctx);
    expect(send).toHaveBeenCalledTimes(3);
    expect(send.mock.calls[2][0]).toEqual({
      action: "delete",
      resource: "dataContext[Mammals].collection[Habitat]",
    });
    expect(out).toMatch(/attribute not found/);
    expect(out).not.toMatch(/document is unchanged/i); // that phrase is for step-1 failures only
    expect(refreshDataContexts).not.toHaveBeenCalled();
  });

  it("reports a distinct message when the rollback delete itself fails, telling the user how " +
    "to remove the empty collection manually", async () => {
    send
      .mockResolvedValueOnce({ success: true }) // collection create
      .mockResolvedValueOnce({ success: false, error: "attribute not found" }) // move fails
      .mockResolvedValueOnce({ success: false, error: "delete not permitted" }); // rollback delete fails
    const v = groupByTool.validate({ dataContext: "Mammals", attribute: "Habitat" }, ctx);
    const out = await groupByTool.execute((v as any).resolved, ctx);
    expect(out).toMatch(/attribute not found/);
    expect(out).toMatch(/empty.*collection.*(exists|remains)/i);
    expect(out).toMatch(/drag/i);
  });

  it("a collection-create failure never attempts the attributeLocation move, and says the " +
    "document is unchanged", async () => {
    send.mockResolvedValueOnce({ success: false, error: "duplicate collection name" });
    const v = groupByTool.validate({ dataContext: "Mammals", attribute: "Habitat" }, ctx);
    const out = await groupByTool.execute((v as any).resolved, ctx);
    expect(send).toHaveBeenCalledTimes(1);
    expect(out).toMatch(/duplicate collection name/);
    expect(out).toMatch(/document is unchanged/i);
    expect(refreshDataContexts).not.toHaveBeenCalled();
  });

  it("falls back to values.error when the top-level error is absent (tolerance), on the " +
    "collection-create leg", async () => {
    send.mockResolvedValueOnce({ success: false, values: { error: "nested duplicate name" } });
    const v = groupByTool.validate({ dataContext: "Mammals", attribute: "Habitat" }, ctx);
    const out = await groupByTool.execute((v as any).resolved, ctx);
    expect(out).toContain("nested duplicate name");
  });
});
