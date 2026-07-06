jest.mock("../../codap-api-utils", () => ({
  getGraphByID: jest.fn(),
  getGraphAdornments: jest.fn(),
}));
import { getGraphByID, getGraphAdornments } from "../../codap-api-utils";
import { getGraphInfoTool } from "./get-graph-info";
import { ILocalToolContext } from "./registry";

const graphs = [{ id: 42, title: "Height vs Age", xAttributeName: "Height", yAttributeName: "Age" }];
const ctx = {
  graphs: () => graphs,
  selectedGraphId: () => "42",
} as unknown as ILocalToolContext;

beforeEach(() => {
  jest.clearAllMocks();
  (getGraphByID as jest.Mock).mockResolvedValue({
    id: 42, title: "Height vs Age", xAttributeName: "Height", yAttributeName: "Age", dataContext: "Mammals",
  });
  (getGraphAdornments as jest.Mock).mockResolvedValue([{ type: "Mean", isVisible: true, value: 12.3 }]);
});

it("defaults to the selected graph and reports structure + adornments", async () => {
  const v = getGraphInfoTool.validate({}, ctx);
  expect(v.ok).toBe(true);
  const out = await getGraphInfoTool.execute((v as any).resolved, ctx);
  expect(out).toContain("Height vs Age");
  expect(out).toContain("Height");
  expect(out).toContain("Mean");
  expect(out).toContain("12.3");
});

it("errors correctively when no graph is selected and none named", () => {
  const v = getGraphInfoTool.validate({}, { ...ctx, selectedGraphId: () => null } as any);
  expect(v.ok).toBe(false);
  expect(!v.ok && v.error).toMatch(/no graph is selected/i);
});
