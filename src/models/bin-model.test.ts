import { types } from "mobx-state-tree";
import { BinModel } from "./bin-model";
import { AppConfigModel } from "./app-config-model";
import { mockAppConfig } from "../test-utils/mock-app-config";

const TestStore = types.model("TestStore", {
  binValues: BinModel,
});

function createStore(values: number[] = []) {
  const appConfig = AppConfigModel.create(mockAppConfig);
  const store = TestStore.create(
    { binValues: { values } },
    { appConfig }
  );
  return store.binValues;
}

// Each bin holds a count of values that fell into it. Summing the counts of all bins
// should equal the number of input values (every value lands in exactly one bin).
function totalItemsAcrossBins(bins: number[]) {
  return bins.reduce((a, b) => a + b, 0);
}

describe("BinModel", () => {
  it("should return empty bins for empty values", () => {
    const bin = createStore([]);
    expect(bin.bins).toEqual([]);
    expect(bin.totalNumberOfBins).toBe(0);
  });

  it("should compute bins for values with a range", () => {
    const bin = createStore([1, 2, 3, 4, 5]);
    expect(bin.totalNumberOfBins).toBe(14);
    expect(bin.bins.length).toBe(bin.totalNumberOfBins);
    expect(totalItemsAcrossBins(bin.bins)).toBe(5);
  });

  it("should place all identical values into a single bin", () => {
    const bin = createStore([5, 5, 5]);
    expect(bin.minValue).toBe(5);
    expect(bin.maxValue).toBe(5);
    expect(bin.binWidth).toBeGreaterThan(0);
    expect(bin.totalNumberOfBins).toBe(1);
    expect(totalItemsAcrossBins(bin.bins)).toBe(3);
  });

  it("should handle a single value", () => {
    const bin = createStore([42]);
    expect(bin.binWidth).toBeGreaterThan(0);
    expect(bin.totalNumberOfBins).toBe(1);
    expect(totalItemsAcrossBins(bin.bins)).toBe(1);
  });

  it("should update bins when setValues is called", () => {
    const bin = createStore([5, 5, 5]);
    expect(bin.totalNumberOfBins).toBe(1);
    expect(totalItemsAcrossBins(bin.bins)).toBe(3);

    bin.setValues([10, 20, 30, 40, 50]);
    expect(bin.minValue).toBe(10);
    expect(bin.maxValue).toBe(50);
    expect(bin.totalNumberOfBins).toBe(14);
    expect(totalItemsAcrossBins(bin.bins)).toBe(5);
  });
});
