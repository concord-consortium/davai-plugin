import { updateAttributeTool } from "./update-attribute";
import { ILocalToolContext } from "./registry";

const dc = {
  name: "Mammals",
  collections: [{ name: "Cases", attrs: [{ name: "Height" }, { name: "Speed" }, { name: "Mass" }] }],
};
const send = jest.fn();
const refreshDataContexts = jest.fn().mockResolvedValue(undefined);
const ctx = {
  dataContexts: () => ({ Mammals: dc }),
  sendCODAPRequest: send,
  refreshDataContexts,
} as unknown as ILocalToolContext;

beforeEach(() => {
  jest.clearAllMocks();
  send.mockResolvedValue({ success: true });
});

describe("validate", () => {
  it("resolves dataContext and attribute (ladder rung 2 repair)", () => {
    const v = updateAttributeTool.validate({ dataContext: "mammals", attribute: "height", unit: "meters" }, ctx);
    expect(v.ok).toBe(true);
    expect((v as any).resolved.attributeName).toBe("Height");
    expect((v as any).resolved.dataContextName).toBe("Mammals");
  });

  it("rejects an unknown attribute before any request", () => {
    const v = updateAttributeTool.validate({ dataContext: "Mammals", attribute: "Weight", unit: "kg" }, ctx);
    expect(v.ok).toBe(false);
    expect((v as any).error).toContain("Height");
    expect(send).not.toHaveBeenCalled();
  });

  it("requires at least one change field, and the corrective lists all five", () => {
    const v = updateAttributeTool.validate({ dataContext: "Mammals", attribute: "Height" }, ctx);
    expect(v.ok).toBe(false);
    expect((v as any).error).toMatch(/newName/i);
    expect((v as any).error).toMatch(/formula/i);
    expect((v as any).error).toMatch(/description/i);
    expect((v as any).error).toMatch(/unit/i);
    expect((v as any).error).toMatch(/position/i);
  });

  it("canonicalizes backticked refs in formula (ladder rung 2 repair reaches CODAP)", () => {
    const v = updateAttributeTool.validate({ dataContext: "Mammals", attribute: "Height", formula: "`speed` * 2" }, ctx);
    expect(v.ok).toBe(true);
    expect((v as any).resolved.formula).toBe("`Speed` * 2");
  });

  it("rejects a formula referencing an unknown attribute", () => {
    const v = updateAttributeTool.validate({ dataContext: "Mammals", attribute: "Height", formula: "`Weight` * 2" }, ctx);
    expect(v.ok).toBe(false);
    expect((v as any).error).toContain("Speed");
  });

  it("accepts a position as a 0-based number", () => {
    const v = updateAttributeTool.validate({ dataContext: "Mammals", attribute: "Height", position: 0 }, ctx);
    expect(v.ok).toBe(true);
    expect((v as any).resolved.position).toBe(0);
  });

  it("accepts newName, description, and unit together with formula (multi-field)", () => {
    const v = updateAttributeTool.validate({
      dataContext: "Mammals", attribute: "Height", newName: "HeightM", description: "in meters", unit: "m", formula: "`Speed`",
    }, ctx);
    expect(v.ok).toBe(true);
    const r = (v as any).resolved;
    expect(r.newName).toBe("HeightM");
    expect(r.description).toBe("in meters");
    expect(r.unit).toBe("m");
    expect(r.formula).toBe("`Speed`");
  });
});

describe("execute: single-field updates", () => {
  it("unit alone sends the attribute update with only unit in values", async () => {
    const v = updateAttributeTool.validate({ dataContext: "Mammals", attribute: "Height", unit: "meters" }, ctx);
    const out = await updateAttributeTool.execute((v as any).resolved, ctx);
    expect(send).toHaveBeenCalledWith({
      action: "update",
      resource: "dataContext[Mammals].collection[Cases].attribute[Height]",
      values: { unit: "meters" },
    });
    expect(out).toBe('Updated attribute "Height" in "Mammals": unit set to "meters".');
  });

  it("description alone", async () => {
    const v = updateAttributeTool.validate({ dataContext: "Mammals", attribute: "Height", description: "body height" }, ctx);
    const out = await updateAttributeTool.execute((v as any).resolved, ctx);
    expect(send).toHaveBeenCalledWith({
      action: "update",
      resource: "dataContext[Mammals].collection[Cases].attribute[Height]",
      values: { description: "body height" },
    });
    expect(out).toBe('Updated attribute "Height" in "Mammals": description set to "body height".');
  });

  it("formula alone, canonicalized, and refreshes data contexts", async () => {
    const v = updateAttributeTool.validate({ dataContext: "Mammals", attribute: "Height", formula: "`speed` * 2" }, ctx);
    const out = await updateAttributeTool.execute((v as any).resolved, ctx);
    expect(send).toHaveBeenCalledWith({
      action: "update",
      resource: "dataContext[Mammals].collection[Cases].attribute[Height]",
      values: { formula: "`Speed` * 2" },
    });
    expect(refreshDataContexts).toHaveBeenCalled();
    expect(out).toBe('Updated attribute "Height" in "Mammals": formula set to `Speed` * 2.');
  });

  it("rename alone sends `name` in values, refreshes data contexts, and names the NEW name " +
    "in the result sentence", async () => {
    const v = updateAttributeTool.validate({ dataContext: "Mammals", attribute: "Height", newName: "HeightM" }, ctx);
    const out = await updateAttributeTool.execute((v as any).resolved, ctx);
    expect(send).toHaveBeenCalledWith({
      action: "update",
      resource: "dataContext[Mammals].collection[Cases].attribute[Height]",
      values: { name: "HeightM" },
    });
    expect(refreshDataContexts).toHaveBeenCalled();
    expect(out).toBe('Updated attribute "HeightM" in "Mammals": renamed to "HeightM".');
  });

  it("position alone sends the documented attributeLocation update form, not the attribute update", async () => {
    const v = updateAttributeTool.validate({ dataContext: "Mammals", attribute: "Height", position: 2 }, ctx);
    const out = await updateAttributeTool.execute((v as any).resolved, ctx);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({
      action: "update",
      resource: "dataContext[Mammals].collection[Cases].attributeLocation[Height]",
      values: { collection: "Cases", position: 2 },
    });
    expect(out).toBe('Updated attribute "Height" in "Mammals": moved to position 2.');
  });
});

describe("execute: multi-field (attribute fields + position)", () => {
  it("sends the attribute update THEN the position update, in that order, and reports both outcomes", async () => {
    const v = updateAttributeTool.validate(
      { dataContext: "Mammals", attribute: "Height", unit: "meters", position: 1 }, ctx);
    const out = await updateAttributeTool.execute((v as any).resolved, ctx);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0][0]).toEqual({
      action: "update",
      resource: "dataContext[Mammals].collection[Cases].attribute[Height]",
      values: { unit: "meters" },
    });
    expect(send.mock.calls[1][0]).toEqual({
      action: "update",
      resource: "dataContext[Mammals].collection[Cases].attributeLocation[Height]",
      values: { collection: "Cases", position: 1 },
    });
    expect(out).toBe('Updated attribute "Height" in "Mammals": unit set to "meters"; moved to position 1.');
  });

  it("combines newName + unit + description into one attribute update and one sentence", async () => {
    const v = updateAttributeTool.validate(
      { dataContext: "Mammals", attribute: "Height", newName: "HeightM", unit: "m", description: "body height" }, ctx);
    const out = await updateAttributeTool.execute((v as any).resolved, ctx);
    expect(send).toHaveBeenCalledWith({
      action: "update",
      resource: "dataContext[Mammals].collection[Cases].attribute[Height]",
      values: { name: "HeightM", unit: "m", description: "body height" },
    });
    // Clause order follows the brief's own field enumeration order (newName, formula,
    // description, unit, position), consistent across every result sentence.
    expect(out).toBe(
      'Updated attribute "HeightM" in "Mammals": renamed to "HeightM"; description set to "body height"; unit set to "m".'
    );
  });
});

describe("execute: failure handling", () => {
  it("summarizes a CODAP failure on the attribute-update leg using the documented top-level error shape", async () => {
    send.mockResolvedValue({ success: false, error: "duplicate name" });
    const v = updateAttributeTool.validate({ dataContext: "Mammals", attribute: "Height", newName: "Speed" }, ctx);
    const out = await updateAttributeTool.execute((v as any).resolved, ctx);
    expect(out).toMatch(/update failed/i);
    expect(out).toContain("duplicate name");
    expect(refreshDataContexts).not.toHaveBeenCalled();
  });

  it("falls back to values.error when the top-level error is absent (tolerance)", async () => {
    send.mockResolvedValue({ success: false, values: { error: "nested duplicate name" } });
    const v = updateAttributeTool.validate({ dataContext: "Mammals", attribute: "Height", unit: "m" }, ctx);
    const out = await updateAttributeTool.execute((v as any).resolved, ctx);
    expect(out).toMatch(/update failed/i);
    expect(out).toContain("nested duplicate name");
  });

  it("a failing position leg is reported without silently dropping the attribute leg's success", async () => {
    send.mockResolvedValueOnce({ success: true }).mockResolvedValueOnce({ success: false, error: "bad position" });
    const v = updateAttributeTool.validate({ dataContext: "Mammals", attribute: "Height", unit: "m", position: 9 }, ctx);
    const out = await updateAttributeTool.execute((v as any).resolved, ctx);
    expect(out).toContain("unit set to");
    expect(out).toMatch(/position.*failed|failed.*position/i);
    expect(out).toContain("bad position");
  });
});
