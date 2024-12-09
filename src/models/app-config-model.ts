import { types, Instance, SnapshotIn } from "mobx-state-tree";
import { Mode } from "../types";

export const AppConfigModel = types.model("AppConfigModel", {
  accessibility: types.model({
    keyboardShortcut: types.string,
  }),
  assistant: types.model({
    assistantId: types.string,
    instructions: types.string,
    model: types.string,
    useExisting: types.boolean,
  }),
  dimensions: types.model({
    width: types.number,
    height: types.number,
  }),
  mockAssistant: types.maybe(types.boolean),
  mode: types.enumeration<Mode>("Mode", ["development", "production", "test"]),
})
.volatile((self) => ({
  isAssistantMocked: self.mode === "development" && self.mockAssistant,
}))
.actions((self) => ({
  toggleMockAssistant() {
    self.mockAssistant = !self.mockAssistant;
    self.isAssistantMocked = self.mode === "development" && self.mockAssistant;
  },
}));

export interface AppConfigModelSnapshot extends SnapshotIn<typeof AppConfigModel> {}
export interface AppConfigModelType extends Instance<typeof AppConfigModel> {}
