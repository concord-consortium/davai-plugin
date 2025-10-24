import { types } from "mobx-state-tree";
import { loadAndApplyMSTSettingOverrides, loadMSTSettingOverrides, SettingsSource, SettingsSourceValue } from "./load-mst-settings";

class MockSettingsSource extends SettingsSource {
  constructor(private settings: Record<string, string | null> = {}) {
    super();
  }

  getItem(key: string): SettingsSourceValue {
    return this.settings[key];
  }

  hasKeyStartingWith(keyPrefix: string): boolean {
    return Object.keys(this.settings).some(key => key.startsWith(keyPrefix));
  }
}

describe("loadMSTSettingOverrides", () => {
  it("should override primitive types from settings source", () => {
    const MockModel = types.model("MockModel", {
      numProp: types.number,
      boolProp: types.boolean,
      strProp: types.string,
    });

    const settingsSource = new MockSettingsSource({
      "numProp": "42",
      "boolProp": "true",
      "strProp": "hello",
    });

    const overrides = loadMSTSettingOverrides(MockModel, settingsSource);

    expect(overrides).toEqual({
      numProp: 42,
      boolProp: true,
      strProp: "hello",
    });
  });

  it("should ignore primitive types that don't exist in settings source", () => {
    const MockModel = types.model("MockModel", {
      numProp1: types.number,
      boolProp1: types.boolean,
      strProp1: types.string,
      numProp2: types.number,
      boolProp2: types.boolean,
      strProp2: types.string,
    });

    const settingsSource = new MockSettingsSource({
      "numProp1": "42",
      "boolProp1": "true",
      "strProp1": "hello",
    });

    const overrides = loadMSTSettingOverrides(MockModel, settingsSource);

    expect(overrides).toEqual({
      numProp1: 42,
      boolProp1: true,
      strProp1: "hello",
    });
  });

  it("should ignore invalid numbers in settings source", () => {
    const MockModel = types.model("MockModel", {
      numProp1: types.number,
      numProp2: types.number,
    });

    const settingsSource = new MockSettingsSource({
      "numProp1": "not-a-number",
      "numProp2": null,
    });

    const overrides = loadMSTSettingOverrides(MockModel, settingsSource);

    expect(overrides).toEqual({});
  });

  it("should treat any boolean value other than 'true' as false, however null is treated as undefined", () => {
    const MockModel = types.model("MockModel", {
      boolProp1: types.boolean,
      boolProp2: types.boolean,
      boolProp3: types.boolean,
      boolProp4: types.boolean,
      boolProp5: types.boolean,
    });

    const settingsSource = new MockSettingsSource({
      "boolProp1": "false",
      "boolProp2": "true",
      "boolProp3": "unexpected-value",
      "boolProp4": "null",
      "boolProp5": null,
    });

    const overrides = loadMSTSettingOverrides(MockModel, settingsSource);

    expect(overrides).toEqual({
      boolProp1: false,
      boolProp2: true,
      boolProp3: false,
      boolProp4: false,
      // boolProp5 is treated as undefined and thus ignored
    });
  });

  it("handles primitive types defined with a value", () => {
    const MockModel = types.model("MockModel", {
      numProp: 10,
      boolProp: false,
      strProp: "default",
    });
    const settingsSource = new MockSettingsSource({
      "numProp": "99",
      "boolProp": "true",
      "strProp": "overridden",
    });

    const overrides = loadMSTSettingOverrides(MockModel, settingsSource);

    expect(overrides).toEqual({
      numProp: 99,
      boolProp: true,
      strProp: "overridden",
    });
  });

  it("handles the prefix parameter", () => {
    const MockModel = types.model("MockModel", {
      strProp: types.string,
    });

    const settingsSource = new MockSettingsSource({
      "prefix:strProp": "hello",
    });
    const overrides = loadMSTSettingOverrides(MockModel, settingsSource, "prefix:");

    expect(overrides).toEqual({
      strProp: "hello",
    });
  });

  it("handles nested models with json values", () => {
    const MockModel = types.model("MockModel", {
      strProp: types.string,
      nested: types.model("NestedModel", {
        nestedNum: types.number,
        nestedBool: types.boolean,
        nestedStr: types.string,
      }),
    });

    const settingsSource = new MockSettingsSource({
      "strProp": "hello",      
      "nested": '{"nestedNum": 42, "nestedBool": true, "nestedStr": "world"}',
    });

    const overrides = loadMSTSettingOverrides(MockModel, settingsSource);

    expect(overrides).toEqual({
      strProp: "hello",
      nested: {
        nestedNum: 42,
        nestedBool: true,
        nestedStr: "world",
      },
    });
  });

  it("handles nested models with dot notation", () => {
    const MockModel = types.model("MockModel", {
      strProp: types.string,
      nested: types.model("NestedModel", {
        nestedNum: types.number,
        nestedBool: types.boolean,
        nestedStr: types.string,
      }),
    });

    const settingsSource = new MockSettingsSource({
      "strProp": "hello",
      "nested.nestedNum": "42",
      "nested.nestedBool": "true",
      "nested.nestedStr": "world",
    });

    const overrides = loadMSTSettingOverrides(MockModel, settingsSource);

    expect(overrides).toEqual({
      strProp: "hello",
      nested: {
        nestedNum: 42,
        nestedBool: true,
        nestedStr: "world",
      },
    });
  });

  it("ignores nested models not present in settings source", () => {
    const MockModel = types.model("MockModel", {
      strProp: types.string,
      nested: types.model("NestedModel", {
        nestedNum: types.number,
        nestedBool: types.boolean,
        nestedStr: types.string,
      }),
    });

    const settingsSource = new MockSettingsSource({
      "strProp": "hello",
    });

    const overrides = loadMSTSettingOverrides(MockModel, settingsSource);

    expect(overrides).toEqual({
      strProp: "hello",
    });
  });

  it("handles array and frozen types with json values", () => {
    const MockModel = types.model("MockModel", {
      arrProp: types.array(types.number),
      frozenProp: types.frozen(),
    });

    const settingsSource = new MockSettingsSource({
      "arrProp": "[1, 2, 3, 4]",
      "frozenProp": '{"key": "value", "num": 42}',
    });

    const overrides = loadMSTSettingOverrides(MockModel, settingsSource);

    expect(overrides).toEqual({
      arrProp: [1, 2, 3, 4],
      frozenProp: { key: "value", num: 42 },
    });
  });

  it("ignores invalid json for array and frozen types", () => {
    const MockModel = types.model("MockModel", {
      arrProp: types.array(types.number),
      frozenProp: types.frozen(),
    });

    const settingsSource = new MockSettingsSource({
      "arrProp": "not-a-json-array",
      "frozenProp": "also-not-json",
    });

    const overrides = loadMSTSettingOverrides(MockModel, settingsSource);

    expect(overrides).toEqual({}); // No valid overrides
  });

  it("handles enumeration types", () => {
    const MockModel = types.model("MockModel", {
      enumProp: types.enumeration("MyEnum", ["value1", "value2", "value3"]),
    });

    const settingsSource = new MockSettingsSource({
      "enumProp": "value2",
    });

    const overrides = loadMSTSettingOverrides(MockModel, settingsSource);

    expect(overrides).toEqual({
      enumProp: "value2",
    });
  });
});

describe("loadAndApplyMSTSettingOverrides", () => {
  it("should apply overrides to an instance", () => {
    const MockModel = types.model("MockModel", {
      numProp: types.number,
      boolProp: types.boolean,
      strProp: types.string,
    });

    const instance = MockModel.create({
      numProp: 0,
      boolProp: false,
      strProp: "initial",
    });

    const settingsSource = new MockSettingsSource({
      "numProp": "100",
      "boolProp": "true",
      "strProp": "overridden",
    });

    loadAndApplyMSTSettingOverrides(instance, settingsSource);

    expect(instance.numProp).toBe(100);
    expect(instance.boolProp).toBe(true);
    expect(instance.strProp).toBe("overridden");
  });

  it("should partially apply overrides to an instance", () => {
    const MockModel = types.model("MockModel", {
      numProp: types.number,
      boolProp: types.boolean,
      strProp: types.string,
    });

    const instance = MockModel.create({
      numProp: 0,
      boolProp: false,
      strProp: "initial",
    });

    const settingsSource = new MockSettingsSource({
      "boolProp": "true",
    });

    loadAndApplyMSTSettingOverrides(instance, settingsSource);

    expect(instance.numProp).toBe(0); // unchanged
    expect(instance.boolProp).toBe(true); // overridden
    expect(instance.strProp).toBe("initial"); // unchanged
  });

  it("throws an error for invalid overrides", () => {
    const MockModel = types.model("MockModel", {
      enumProp: types.enumeration("MyEnum", ["value1", "value2", "value3"]),
    });

    const instance = MockModel.create({
      enumProp: "value1",
    });
    const settingsSource = new MockSettingsSource({
      "enumProp": "invalidValue",
    });

    expect(() => {
      loadAndApplyMSTSettingOverrides(instance, settingsSource);
    }).toThrow();
  });
});

