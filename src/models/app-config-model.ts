import { types, Instance, SnapshotIn } from "mobx-state-tree";
import { AppMode, AppModeValues } from "../types";

/**
 * AppConfigModel encapsulates the application's configuration settings.
 * It includes properties and methods for managing accessibility, AI assistant settings, and the application's mode.
 * 
 * @property {Object} accessibility - Settings related to accessibility in the UI.
 * @property {string} accessibility.keyboardShortcut - Custom keystroke for placing focus in the main text input field (e.g., `ctrl+?`).
 * 
 * @property {Object} assistant - Settings to configure the AI assistant.
 * @property {string} assistant.assistantId - The unique ID of an existing assistant to use.
 * @property {string} assistant.instructions - Instructions to use when creating new assistants (e.g., `You are helpful data analysis partner.`).
 * @property {string} assistant.modelName - The name of the model the assistant should use (e.g., `gpt-4o-mini`).
 * @property {boolean} assistant.useExisting - Whether to use an existing assistant.
 * 
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
  assistant: types.model({
    assistantId: types.string,
    instructions: types.string,
    modelName: types.string,
    useExisting: types.boolean,
  }),
  dimensions: types.model({
    width: types.number,
    height: types.number,
  }),
  mockAssistant: types.maybe(types.boolean),
  mode: types.enumeration<AppMode>("Mode", AppModeValues),
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
