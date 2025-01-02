import { types, Instance, SnapshotIn } from "mobx-state-tree";
import { AppMode, AppModeValues } from "../types";

/**
 * AppConfigModel encapsulates the application's configuration settings.
 * It includes properties and methods for managing accessibility, AI assistant settings, and the application's mode.
 *
 * @property {Object} accessibility - Settings related to accessibility in the UI.
 * @property {string} accessibility.keyboardShortcut - Custom keystroke for placing focus in the main text input field (e.g., `ctrl+?`).
 * @property {string} assistantId - The unique ID of an existing assistant to use, or "mock" for a mocked assistant.
 * @property {Object} dimensions - Dimensions of the application's component within CODAP.
 * @property {number} dimensions.width - The width of the application (in pixels).
 * @property {number} dimensions.height - The height of the application (in pixels).
 *
 * @property {boolean|null} mockAssistant - A flag indicating whether to mock AI interactions. (optional).
 *
 * @property {"development"|"production"|"test"} mode - The mode in which the application runs.
 */
export const AppConfigModel = types.model("AppConfigModel", {
  accessibility: types.model({
    keyboardShortcut: types.string,
  }),
  assistantId: types.string,
  dimensions: types.model({
    width: types.number,
    height: types.number,
  }),
  mode: types.enumeration<AppMode>("Mode", AppModeValues),
})
.volatile((self) => ({
  isAssistantMocked: self.assistantId === "mock",
}))
.actions((self) => ({
  setAssistantId(assistantId: string) {
    self.assistantId = assistantId;
  },
  setMockAssistant(mockAssistant: boolean) {
    self.isAssistantMocked = self.mode === "development" && mockAssistant;
  }
}));

export interface AppConfigModelSnapshot extends SnapshotIn<typeof AppConfigModel> {}
export interface AppConfigModelType extends Instance<typeof AppConfigModel> {}
