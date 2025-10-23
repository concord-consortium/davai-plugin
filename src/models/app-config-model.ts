import { types, Instance, SnapshotIn } from "mobx-state-tree";
import { AppMode, AppModeValues } from "../types";

/**
 * AppConfigModel encapsulates the application's configuration settings.
 * It includes properties and methods for managing accessibility, AI assistant settings, and the application's mode.
 *
 * @property {Object} accessibility - Settings related to accessibility in the UI.
 * @property {string} accessibility.keyboardShortcut - Custom keystroke for placing focus in the main text input field (e.g., `ctrl+?`).
 * @property {Object} dimensions - Dimensions of the application's component within CODAP.
 * @property {number} dimensions.width - The width of the application (in pixels).
 * @property {number} dimensions.height - The height of the application (in pixels).
 * @property {string} llmId - The unique ID of an LLM to use, or "mock" for a mocked LLM.
 *
 * @property {boolean|null} mockAssistant - A flag indicating whether to mock AI interactions. (optional).
 *
 * @property {"development"|"production"|"test"} mode - The mode in which the application runs.
 */
export const AppConfigModel = types.model("AppConfigModel", {
  accessibility: types.model({
    keyboardShortcut: types.string,
  }),
  llmId: types.string,
  llmList: types.array(types.frozen()),
  dimensions: types.model({
    width: types.number,
    height: types.number,
  }),
  mode: types.enumeration<AppMode>("Mode", AppModeValues),
})
.views((self) => ({
  get isAssistantMocked() {
    const llmData = JSON.parse(self.llmId || "");
    return llmData.id === "mock";
  }
}))
.actions((self) => ({
  setLlmId(llmId: string) {
    self.llmId = llmId;
  }
}));

export interface AppConfigModelSnapshot extends SnapshotIn<typeof AppConfigModel> {}
export interface AppConfigModelType extends Instance<typeof AppConfigModel> {}
