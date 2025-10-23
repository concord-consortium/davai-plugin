import { types } from "mobx-state-tree";
import { addMSTSettingsSaver, diffObjects, ISettingsDestination } from "./save-mst-settings";
import { SettingsSource, SettingsSourceValue } from "./load-mst-settings";

class MockSettings extends SettingsSource implements ISettingsDestination {
  constructor(public store: Record<string, string | null> = {}) {
    super();
  }

  getItem(key: string): SettingsSourceValue {
    return this.store[key];
  }

  setItem(key: string, value: string): void {
    this.store[key] = value;
  }

  hasKeyStartingWith(keyPrefix: string): boolean {
    return Object.keys(this.store).some(key => key.startsWith(keyPrefix));
  }
}

describe("addMSTSettingsSaver", () => {
  const MockModel = types.model("MockModel", {
    numProp: types.number,
    boolProp: types.boolean,
    strProp: types.string,
  })
  .actions((self) => ({
    update(callback: () => void) {
      callback();
    }
  }));


  it("should save settings as a single object when the depth is 0", () => {
    const settings = new MockSettings({});
    const instance = MockModel.create({
      numProp: 0,
      boolProp: false,
      strProp: "initial",
    });
    addMSTSettingsSaver(instance, settings, settings, "mst-settings", 0);

    // Simulate a snapshot change
    instance.update(() => {
      instance.numProp = 42;
    });

    expect(settings.store).toEqual({
      "mst-settings": "{\"numProp\":42}"
    });
  });

  it("should save settings as separate properties when the depth is 1", () => {
    const settings = new MockSettings({});
    const instance = MockModel.create({
      numProp: 0,
      boolProp: false,
      strProp: "initial",
    });
    addMSTSettingsSaver(instance, settings, settings, "", 1);

    // Simulate a snapshot change
    instance.update(() => {
      instance.numProp = 42;
    });

    expect(settings.store).toEqual({
      "numProp": "42"
    });
  });

  it("should save settings as multiple properties when the depth is 1", () => {
    const settings = new MockSettings({});
    const instance = MockModel.create({
      numProp: 0,
      boolProp: false,
      strProp: "initial",
    });
    addMSTSettingsSaver(instance, settings, settings, "", 1);

    // Simulate a snapshot change
    instance.update(() => {
      instance.numProp = 42;
      instance.boolProp = true;
      instance.strProp = "changed";
    });

    expect(settings.store).toEqual({
      "numProp": "42",
      "boolProp": "true",
      "strProp": "changed",
    });  
  });
  it("should save array settings when the depth is 1", () => {
    const MockModel2 = types.model("MockModel2", {
      arrProp: types.array(types.number),
    })
    .actions((self) => ({
      update(callback: () => void) {
        callback();
      }
    }));
    const settings = new MockSettings({});
    const instance = MockModel2.create({
      arrProp: [1, 2, 3],
    });
    addMSTSettingsSaver(instance, settings, settings, "", 1);

    // Simulate a snapshot change
    instance.update(() => {
      instance.arrProp.push(4);
    });

    expect(settings.store).toEqual({
      "arrProp": "[1,2,3,4]"
    });
  });
  it("should save the setting when it is reset to the default value", () => {
    const settings = new MockSettings({});
    const instance = MockModel.create({
      strProp: "initial",
      numProp: 0,
      boolProp: false,
    });
    addMSTSettingsSaver(instance, settings, settings, "", 1);

    // Simulate a snapshot change
    instance.update(() => {
      instance.strProp = "changed";
    });

    expect(settings.store).toEqual({
      "strProp": "changed"
    });

    // Reset to the default value
    instance.update(() => {
      instance.strProp = "initial";
    });

    expect(settings.store).toEqual({
      "strProp": "initial"
    });
  });
  describe("nested properties", () => {
    const MockModel2 = types.model("MockModel", {
      strProp: types.string,
      nested: types.model({
        numProp: types.number,
        boolProp: types.boolean,
      })
    })
    .actions((self) => ({
      update(callback: () => void) {
        callback();
      }
    }));

    it("should save nested properties when the depth is 1", () => {
      const settings = new MockSettings({});
      const instance = MockModel2.create({
        strProp: "initial",
        nested: {
          numProp: 0,
          boolProp: false,
        },
      });
      addMSTSettingsSaver(instance, settings, settings, "", 1);

      instance.update(() => {
        instance.nested.numProp = 42;
      });
      expect(settings.store).toEqual({
        "nested": "{\"numProp\":42}"
      });
    });

    it("should handle nested properties that are reset to default values", () => {
      const settings = new MockSettings({});
      const instance = MockModel2.create({
        strProp: "initial",
        nested: {
          numProp: 0,
          boolProp: false,
        },
      });
      addMSTSettingsSaver(instance, settings, settings, "", 1);

      instance.update(() => {
        instance.nested.numProp = 42;
      });
      expect(settings.store).toEqual({
        "nested": "{\"numProp\":42}"
      });

      // Reset to the default value
      instance.update(() => {
        instance.nested.numProp = 0;
      });

      expect(settings.store).toEqual({
        "nested": "{\"numProp\":0}"
      });
    });
  });
});

describe("diffObjects", () => {
  it("should return an object with only the properties that differ between two objects", () => {
    const objA = {
      a: 1,
      b: 2,
      c: 3,
    };
    const objB = {
      a: 1,
      b: 3,
      d: 4,
    };
    const result = diffObjects(objA, objB);
    expect(result).toEqual({
      b: 3,
      d: 4,
    });
  });
  it("handle arrays by writing out the full array if they differ", () => {
    const objA = {
      arr: [1, 2, 3],
    };
    const objB = {
      arr: [1, 2, 4],
    };
    const result = diffObjects(objA, objB);
    expect(result).toEqual({
      arr: [1, 2, 4],
    });
  });
});
