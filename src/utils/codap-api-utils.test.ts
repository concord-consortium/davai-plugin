import { codapInterface } from "@concord-consortium/codap-plugin-api";
import { getCollectionItemsForAttributePair, trimDataset } from "./codap-api-utils";
import { before } from "node:test";

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

  it("should retrieve items for attributes the same collection", async () => {
    const items = await getCollectionItemsForAttributePair(mockDataContext, "attrC", "attrD");
    expect(items).toEqual([
      { id: "3", values: { attrC: "C1", attrD: "D1" } },
      { id: "4", values: { attrC: "C2", attrD: "D2" } }
    ]);
  });
});
