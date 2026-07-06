import { createAdornmentTool } from "./create-adornment";
import { ILocalToolContext } from "./registry";

const graphs = [{ id: 42, title: "Heights" }];
const send = jest.fn();
const ctx = {
  graphs: () => graphs,
  selectedGraphId: () => "42",
  sendCODAPRequest: send,
} as unknown as ILocalToolContext;

beforeEach(() => jest.clearAllMocks());

it("normalizes type aliases and sends the canonical adornment create", async () => {
  send.mockResolvedValue({ success: true, values: { type: "Standard Deviation", data: [{ min: 1, max: 9, mean: 5 }] } });
  const v = createAdornmentTool.validate({ type: "std dev" }, ctx);
  expect(v.ok).toBe(true);
  await createAdornmentTool.execute((v as any).resolved, ctx);
  expect(send).toHaveBeenCalledWith({
    action: "create",
    resource: "component[42].adornment",
    values: { type: "Standard Deviation" },
  });
});

it("reports the computed value from the create response (Mean)", async () => {
  send.mockResolvedValue({ success: true, values: { type: "Mean", data: [{ mean: 10.79 }] } });
  const v = createAdornmentTool.validate({ type: "mean" }, ctx);
  const out = await createAdornmentTool.execute((v as any).resolved, ctx);
  expect(out).toContain("10.79");
});

it("reports LSRL slope/intercept/rSquared", async () => {
  send.mockResolvedValue({ success: true, values: { type: "LSRL", data: [{ slope: -1.98, intercept: 46.08, rSquared: 0.29 }] } });
  const v = createAdornmentTool.validate({ type: "least squares line" }, ctx);
  const out = await createAdornmentTool.execute((v as any).resolved, ctx);
  expect(out).toContain("-1.98");
  expect(out).toContain("46.08");
});

it("rejects unknown types with the options list", () => {
  const v = createAdornmentTool.validate({ type: "mode" }, ctx);
  expect(v.ok).toBe(false);
  expect((v as any).error).toContain("mean");
});

it("summarizes CODAP rejection (wrong plot type) correctively using the documented top-level error shape", async () => {
  send.mockResolvedValue({ success: false, error: "not applicable" });
  const v = createAdornmentTool.validate({ type: "lsrl" }, ctx);
  const out = await createAdornmentTool.execute((v as any).resolved, ctx);
  expect(out).toMatch(/could not be added/i);
  expect(out).toContain("not applicable");
});

it("falls back to values.error when the top-level error is absent (tolerance)", async () => {
  send.mockResolvedValue({ success: false, values: { error: "nested not applicable" } });
  const v = createAdornmentTool.validate({ type: "lsrl" }, ctx);
  const out = await createAdornmentTool.execute((v as any).resolved, ctx);
  expect(out).toMatch(/could not be added/i);
  expect(out).toContain("nested not applicable");
});
