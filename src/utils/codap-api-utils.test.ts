import { codapInterface } from "@concord-consortium/codap-plugin-api";
import { getCollectionItemsForAttributePair, getGraphAdornments, getSelectionList, trimDataset } from "./codap-api-utils";

// mock Node.js's structuredClone function
if (!globalThis.structuredClone) {
  globalThis.structuredClone = (value: any) => JSON.parse(JSON.stringify(value));
}

jest.spyOn(globalThis, "structuredClone").mockImplementation((value) => {
  return JSON.parse(JSON.stringify(value));
});

jest.mock("@concord-consortium/codap-plugin-api", () => ({
  codapInterface: {
    sendRequest: jest.fn()
  }
}));

describe("trimDataset", () => {
  it("should remove _categoryMap from each attribute in a collection", () => {
    const dataset = {
      context1: {
        collections: [
          {
            attrs: [
              { name: "attr1", _categoryMap: { a: 1 } },
              { name: "attr2", _categoryMap: { b: 2 }  },
              { name: "attr3", _categoryMap: { c: 3 } }
            ]
          }
        ]
      },
      context2: {
        collections: [
          {
            attrs: [{ name: "attr4", _categoryMap: { d: 4 } }]
          }
        ]
      }
    };
    const trimmed = trimDataset(dataset);
    expect(trimmed.context1.collections[0].attrs).toEqual([
      { name: "attr1" },
      { name: "attr2" },
      { name: "attr3" }
    ]);
    expect(trimmed.context2.collections[0].attrs).toEqual([{ name: "attr4" }]);
  });

  it("should return an empty object if no collections are present", () => {
    const dataset = {};
    const trimmed = trimDataset(dataset);
    expect(trimmed).toEqual({});
  });

  it("should handle cases where collections are not arrays", () => {
    const dataset = {
      context1: {
        collections: "not an array"
      }
    };
    const trimmed = trimDataset(dataset);
    expect(trimmed).toEqual({ context1: { collections: "not an array" } });
  });

  it("should handle cases where attrs are not arrays", () => {
    const dataset = {
      context1: {
        collections: [
          {
            attrs: "not an array"
          }
        ]
      }
    };
    const trimmed = trimDataset(dataset);
    expect(trimmed).toEqual({ context1: { collections: [{ attrs: "not an array" }] } });
  });

  it("should return the original dataset if no _categoryMap attributes are present", () => {
    const dataset = {
      context1: {
        collections: [
          {
            attrs: [{ name: "attr1" }, { name: "attr2" }]
          }
        ]
      }
    };
    const trimmed = trimDataset(dataset);
    expect(trimmed).toEqual(dataset);
  });

});

describe("getCollectionItems", () => {
  const mockDataContext = {
    name: "dataContext1",
    collections: [
      {
        name: "collection0",
        attrs: [
          { id: 1, name: "attrA" },
          { id: 2, name: "attrB" }
        ]
      },
      {
        name: "collection1",
        attrs: [
          { id: 3, name: "attrC" },
          { id: 4, name: "attrD" }
        ]
      },
      {
        name: "collection2",
        attrs: [
          { id: 5, name: "attrE" },
          { id: 6, name: "attrF" }
        ]
      }
    ]
  };
  beforeEach(() => {
    jest.clearAllMocks();
    // Mock the codapInterface.sendRequest to return items for collections
    (codapInterface.sendRequest as jest.Mock).mockImplementation(({ resource }: { resource: string }) => {
      if (resource === "dataContext[dataContext1].collection[collection0].allCases") {
        return Promise.resolve({
          success: true,
          values: {
            cases: [
              { case: { id: 1, values: { attrA: "A1", attrB: "B1" } } },
              { case: { id: 2, values: { attrA: "A2", attrB: "B2" } } }
            ]
          }
        });
      } else if (resource === "dataContext[dataContext1].collection[collection1].allCases") {
        return Promise.resolve({
          success: true,
          values: {
            cases: [
              { case: { id: 3, parent: 1, values: { attrC: "C1", attrD: "D1" } } },
              { case: { id: 4, parent: 2, values: { attrC: "C2", attrD: "D2" } } }
            ]
          }
        });
      } else if (resource === "dataContext[dataContext1].collection[collection2].allCases") {
        return Promise.resolve({
          success: true,
          values: {
            cases: [
              { case: { id: 5, parent: 3, values: { attrE: "E1", attrF: "F1" } } },
              { case: { id: 6, parent: 4, values: { attrE: "E2", attrF: "F2" } } }
            ]
          }
        });
      }
      return Promise.resolve({ values: [] });
    });
  });

  it("should retrieve items for attributes in neighboring collections", async () => {
    const items = await getCollectionItemsForAttributePair(mockDataContext, "attrC", "attrE");
    expect(items).toEqual([
      { id: "3/5", values: { attrC: "C1", attrE: "E1" } },
      { id: "4/6", values: { attrC: "C2", attrE: "E2" } }
    ]);
  });

  it("should retrieve items for attributes in separated collections", async () => {
    const items = await getCollectionItemsForAttributePair(mockDataContext, "attrA", "attrE");
    expect(items).toEqual([
      { id: "1/3/5", values: { attrA: "A1", attrE: "E1" } },
      { id: "2/4/6", values: { attrA: "A2", attrE: "E2" } }
    ]);
  });

  it("should retrieve items for attributes in the same collection", async () => {
    const items = await getCollectionItemsForAttributePair(mockDataContext, "attrC", "attrD");
    expect(items).toEqual([
      { id: "3", values: { attrC: "C1", attrD: "D1" } },
      { id: "4", values: { attrC: "C2", attrD: "D2" } }
    ]);
  });
});

describe("getGraphAdornments", () => {
  /**
   * Helper to mock CODAP adornment requests.
   * Each entry describes an adornment on the list.
   * If `data` is provided, the detail request for that type will return it.
   * If `error` is true, the detail request will reject with an error.
   * Otherwise, the detail request returns success: false which should cause the adornment to be skipped.
   */
  function mockAdornmentRequests(
    adornments: Array<{
      type: string;
      isVisible: boolean;
      data?: Record<string, number>;
      error?: boolean;
    }>
  ) {
    (codapInterface.sendRequest as jest.Mock).mockImplementation(({ resource }: { resource: string }) => {
      if (resource === "component[1].adornmentList") {
        return Promise.resolve({
          success: true,
          values: adornments.map((a, i) => ({
            id: `ADRN${i + 1}`, type: a.type, isVisible: a.isVisible
          }))
        });
      }

      for (const adornment of adornments) {
        if (resource === `component[1].adornment[${adornment.type}]`) {
          if (adornment.error) {
            return Promise.reject(new Error(`Error fetching ${adornment.type}`));
          }
          if (adornment.data) {
            return Promise.resolve({
              success: true,
              values: {
                id: `ADRN${adornments.indexOf(adornment) + 1}`,
                type: adornment.type,
                isVisible: adornment.isVisible,
                data: [adornment.data]
              }
            });
          }
        }
      }

      return Promise.resolve({ success: false });
    });
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should parse mean, median, and standard deviation adornments", async () => {
    mockAdornmentRequests([
      { type: "Mean", isVisible: true, data: { mean: 24.85 } },
      { type: "Median", isVisible: true, data: { median: 22.0 } },
      { type: "Standard Deviation", isVisible: true, data: { min: 10.5, max: 39.2, mean: 24.85 } }
    ]);

    const result = await getGraphAdornments(1);
    expect(result).toEqual([
      { type: "Mean", isVisible: true, value: 24.85 },
      { type: "Median", isVisible: true, value: 22.0 },
      { type: "Standard Deviation", isVisible: true, min: 10.5, max: 39.2, mean: 24.85 }
    ]);
  });

  it("should filter out non-visible adornments", async () => {
    mockAdornmentRequests([
      { type: "Mean", isVisible: false, data: { mean: 24.85 } },
      { type: "Median", isVisible: true, data: { median: 22.0 } }
    ]);

    const result = await getGraphAdornments(1);
    expect(result).toEqual([
      { type: "Median", isVisible: true, value: 22.0 }
    ]);
  });

  it("should filter out adornment types not of interest", async () => {
    mockAdornmentRequests([
      { type: "Mean", isVisible: true, data: { mean: 24.85 } },
      { type: "Count", isVisible: true }
    ]);

    const result = await getGraphAdornments(1);
    expect(result).toEqual([
      { type: "Mean", isVisible: true, value: 24.85 }
    ]);
  });

  it("should return an empty array when no adornments are visible", async () => {
    mockAdornmentRequests([
      { type: "Mean", isVisible: false, data: { mean: 24.85 } }
    ]);

    const result = await getGraphAdornments(1);
    expect(result).toEqual([]);
  });

  it("should skip an adornment whose detail request fails", async () => {
    mockAdornmentRequests([
      { type: "Mean", isVisible: true, error: true },
      { type: "Median", isVisible: true, data: { median: 11.0 } }
    ]);

    const warnSpy = jest.spyOn(console, "warn").mockImplementation();
    const result = await getGraphAdornments(1);
    expect(result).toEqual([
      { type: "Median", isVisible: true, value: 11.0 }
    ]);
    expect(warnSpy).toHaveBeenCalledWith(
      "Failed to get adornment data for Mean:",
      expect.any(Error)
    );
    warnSpy.mockRestore();
  });

  it("should return an empty array when the adornment list request fails", async () => {
    (codapInterface.sendRequest as jest.Mock).mockResolvedValue({ success: false });

    const result = await getGraphAdornments(1);
    expect(result).toEqual([]);
  });

  it("should return an empty array when the list request throws", async () => {
    (codapInterface.sendRequest as jest.Mock).mockRejectedValue(new Error("Network error"));

    const warnSpy = jest.spyOn(console, "warn").mockImplementation();
    const result = await getGraphAdornments(1);
    expect(result).toEqual([]);
    expect(warnSpy).toHaveBeenCalledWith(
      "Failed to get graph adornments:",
      expect.any(Error)
    );
    warnSpy.mockRestore();
  });
});

describe("getSelectionList", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should return selection items for a data context", async () => {
    (codapInterface.sendRequest as jest.Mock).mockResolvedValue({
      success: true,
      values: [
        { caseID: 10, collectionID: 5, collectionName: "Cases" },
        { caseID: 20, collectionID: 5, collectionName: "Cases" }
      ]
    });

    const result = await getSelectionList("context1");
    expect(codapInterface.sendRequest).toHaveBeenCalledWith({
      action: "get",
      resource: "dataContext[context1].selectionList"
    });
    expect(result).toEqual([
      { caseID: 10, collectionID: 5, collectionName: "Cases" },
      { caseID: 20, collectionID: 5, collectionName: "Cases" }
    ]);
  });

  it("should return an empty array when no cases are selected", async () => {
    (codapInterface.sendRequest as jest.Mock).mockResolvedValue({
      success: true,
      values: []
    });

    const result = await getSelectionList("context1");
    expect(result).toEqual([]);
  });

  it("should return an empty array when the request fails", async () => {
    (codapInterface.sendRequest as jest.Mock).mockResolvedValue({
      success: false
    });

    const result = await getSelectionList("context1");
    expect(result).toEqual([]);
  });

  it("should return an empty array when values is not an array", async () => {
    (codapInterface.sendRequest as jest.Mock).mockResolvedValue({
      success: true,
      values: "unexpected"
    });

    const result = await getSelectionList("context1");
    expect(result).toEqual([]);
  });
});
