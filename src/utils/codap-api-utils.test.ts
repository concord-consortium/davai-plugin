import { trimDataset } from "./codap-api-utils"

// mock Node.js's structuredClone function
if (!globalThis.structuredClone) {
  globalThis.structuredClone = (value: any) => JSON.parse(JSON.stringify(value));
}

jest.spyOn(globalThis, "structuredClone").mockImplementation((value) => {
  return JSON.parse(JSON.stringify(value));
});

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
