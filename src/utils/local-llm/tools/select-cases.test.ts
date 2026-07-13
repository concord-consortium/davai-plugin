jest.mock("../../codap-api-utils", () => ({ getSelectionList: jest.fn() }));
import { getSelectionList } from "../../codap-api-utils";
import { selectCasesTool } from "./select-cases";
import { ILocalToolContext } from "./registry";

const dc = { name: "Mammals", collections: [{ name: "Cases", attrs: [{ name: "Weight" }] }] };
const send = jest.fn().mockResolvedValue({ success: true });
const ctx = { dataContexts: () => ({ Mammals: dc }), sendCODAPRequest: send } as unknown as ILocalToolContext;

beforeEach(() => {
  jest.clearAllMocks();
  send.mockResolvedValue({ success: true });
  (getSelectionList as jest.Mock).mockResolvedValue([{ caseID: 1 }, { caseID: 2 }]);
});

// A worked percentile example in argsExample (the model's most-imitated part of a tool doc)
// steers toward calling select_cases directly with the correct CODAP percentile form, rather
// than hand-computing percentiles or picking the wrong threshold shape.
it("argsExample is a worked percentile example (DAVAI-126 matrix round 3 E5)", () => {
  expect(selectCasesTool.argsExample).toBe(
    '{"tool": "select_cases", "dataContext": "Mammals", "expression": "`Height` > percentile(`Height`, 0.75)", "mode": "replace"}'
  );
});

it("description keeps the 0-1 percentile note (DAVAI-126 matrix round 3 E5)", () => {
  expect(selectCasesTool.description).toMatch(/percentile takes 0.1/); // "0–1" (en dash) or "0-1"
});

it("validates backticked refs in the expression against the schema", () => {
  const bad = selectCasesTool.validate(
    { dataContext: "Mammals", expression: "`Speed` > 10", mode: "replace" }, ctx);
  expect(bad.ok).toBe(false);
  expect((bad as any).error).toContain("Weight");
});

it("replace mode sends action create and reports the selected count", async () => {
  const v = selectCasesTool.validate(
    { dataContext: "Mammals", expression: "`Weight` > mean(`Weight`)", mode: "replace" }, ctx);
  expect(v.ok).toBe(true);
  const out = await selectCasesTool.execute((v as any).resolved, ctx);
  expect(send).toHaveBeenCalledWith({
    action: "create",
    resource: "dataContext[Mammals].selectionList",
    values: { expression: "`Weight` > mean(`Weight`)" },
  });
  expect(out).toContain("2 cases");
});

it("canonicalizes repaired refs in the sent expression (ladder rung 2)", async () => {
  const v = selectCasesTool.validate(
    { dataContext: "Mammals", expression: "`weight` > mean(`weight`)", mode: "replace" }, ctx);
  expect(v.ok).toBe(true);
  await selectCasesTool.execute((v as any).resolved, ctx);
  expect(send).toHaveBeenCalledWith({
    action: "create",
    resource: "dataContext[Mammals].selectionList",
    values: { expression: "`Weight` > mean(`Weight`)" },
  });
});

it("extend mode sends action update", async () => {
  const v = selectCasesTool.validate(
    { dataContext: "Mammals", expression: "`Weight` < 5", mode: "extend" }, ctx);
  await selectCasesTool.execute((v as any).resolved, ctx);
  expect(send.mock.calls[0][0].action).toBe("update");
});

it("omitted mode defaults to replace (action create)", async () => {
  const v = selectCasesTool.validate(
    { dataContext: "Mammals", expression: "`Weight` < 5" }, ctx);
  expect(v.ok).toBe(true);
  await selectCasesTool.execute((v as any).resolved, ctx);
  expect(send.mock.calls[0][0].action).toBe("create");
});

it("summarizes CODAP failure without a raw dump (documented top-level error shape)", async () => {
  send.mockResolvedValue({ success: false, error: "bad expression" });
  const v = selectCasesTool.validate(
    { dataContext: "Mammals", expression: "`Weight` >", mode: "replace" }, ctx);
  const out = await selectCasesTool.execute((v as any).resolved, ctx);
  expect(out).toMatch(/selection failed/i);
  expect(out).toContain("bad expression");
});

it("falls back to values.error when the top-level error is absent (tolerance)", async () => {
  send.mockResolvedValue({ success: false, values: { error: "nested bad expression" } });
  const v = selectCasesTool.validate(
    { dataContext: "Mammals", expression: "`Weight` >", mode: "replace" }, ctx);
  const out = await selectCasesTool.execute((v as any).resolved, ctx);
  expect(out).toMatch(/selection failed/i);
  expect(out).toContain("nested bad expression");
});

it("nudges toward the percentile-as-fraction fix when the selection matches zero cases " +
  "(DAVAI-126 eval round 2 item E)", async () => {
  (getSelectionList as jest.Mock).mockResolvedValue([]);
  const v = selectCasesTool.validate(
    { dataContext: "Mammals", expression: "`Weight` > percentile(`Weight`, 75)", mode: "replace" }, ctx);
  expect(v.ok).toBe(true);
  const out = await selectCasesTool.execute((v as any).resolved, ctx);
  expect(out).toBe(
    'Selected 0 cases in "Mammals" — no cases matched. Check the expression (percentile takes a ' +
    "fraction 0–1, e.g. percentile(`Height`, 0.75))."
  );
});

it("keeps the existing non-zero wording unchanged (DAVAI-126 eval round 2 item E)", async () => {
  (getSelectionList as jest.Mock).mockResolvedValue([{ caseID: 1 }]);
  const v = selectCasesTool.validate(
    { dataContext: "Mammals", expression: "`Weight` > 5", mode: "replace" }, ctx);
  const out = await selectCasesTool.execute((v as any).resolved, ctx);
  expect(out).toBe('Selected 1 cases in "Mammals" (replace mode).');
});
