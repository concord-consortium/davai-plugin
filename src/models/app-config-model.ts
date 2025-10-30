import { types, Instance, SnapshotIn, SnapshotOut, TypeOfValue, getType, isStateTreeNode } from "mobx-state-tree";
import { AppMode, AppModeValues } from "../types";

// Selects keys from T whose values are boolean
type BooleanKeys<T> = {
  [K in keyof T]: T[K] extends boolean ? K : never
}[keyof T];

/**
 * AppConfigModel encapsulates the application's configuration settings.
 * It includes properties and methods for managing accessibility, AI assistant settings, and the application's mode.
 *
 * @property {Object} keyboardShortcuts - Custom keystrokes
 * @property {string} keyboardShortcuts.focusChatInput - placing focus in the main text input field (e.g., `Control+Shift+/`).
 * @property {string} keyboardShortcuts.playGraphSonification - playing the graph sonification (e.g., `Control+Shift+.`) (not implemented yet).
 * @property {boolean} keyboardShortcutsEnabled - Whether keyboard shortcuts are enabled.
 * @property {boolean} playProcessingMessage - Whether to play a message when processing starts.
 * @property {boolean} playProcessingTone - Whether to play a tone when processing starts.
 * @property {number} playbackSpeed - The speed at which read-aloud messages are played back. (not implemented yet)
 * @property {boolean} readAloudEnabled - Whether the read-aloud feature is enabled. (not implemented yet)
 * @property {Object} dimensions - Dimensions of the application's component within CODAP.
 * @property {number} dimensions.width - The width of the application (in pixels).
 * @property {number} dimensions.height - The height of the application (in pixels).
 * @property {string} llmId - The unique ID of an LLM to use, or "mock" for a mocked LLM.
 * @property {Object} llmList - The list of available LLMs.
 * @property {"development"|"production"|"test"} mode - The mode in which the application runs.
 * @property {boolean} showDebugLogInDevMode - Whether to show the debug log when in development mode.
 */
export const AppConfigModel = types.model("AppConfigModel", {
  keyboardShortcuts: types.model({
    focusChatInput: types.string,
    playGraphSonification: types.string,
  }),
  keyboardShortcutsEnabled: types.boolean,
  playProcessingMessage: types.boolean,
  playProcessingTone: types.boolean,
  playbackSpeed: types.number,
  readAloudEnabled: types.boolean,
  llmId: types.string,
  llmList: types.array(types.frozen()),
  dimensions: types.model({
    width: types.number,
    height: types.number,
  }),
  mode: types.enumeration<AppMode>("Mode", AppModeValues),
  showDebugLogInDevMode: true,
  /**
   * The default number of bins to use for graph sonification of univariate data.
   * If set to 0, an automatic binning strategy that matches CODAP's
   * "Group into Bins" is used.
   */
  defaultNumBins: 14,
})
.views((self) => ({
  get isDevMode() {
    return self.mode === "development";
  }
}))
.views((self) => ({
  get isAssistantMocked() {
    const llmData = JSON.parse(self.llmId || "");
    return llmData.id === "mock";
  },
  get showDebugLog() {
    return self.isDevMode && self.showDebugLogInDevMode;
  }
}))
.actions((self) => ({
  setLlmId(llmId: string) {
    self.llmId = llmId;
  },
  toggleOption(option: BooleanKeys<SnapshotOut<TypeOfValue<typeof self>>>) {
    self[option] = !self[option];
  },
  update(action: () => void) {
    action();
  }
}));

export interface AppConfigModelSnapshot extends SnapshotIn<typeof AppConfigModel> {}
export interface AppConfigModelType extends Instance<typeof AppConfigModel> {}

export function isAppConfig(obj: unknown): obj is AppConfigModelType {
  return !!obj && typeof obj === "object"
    && isStateTreeNode(obj) && getType(obj) === AppConfigModel;
}

export type AppConfigToggleOptions = Parameters<AppConfigModelType["toggleOption"]>[0];
export type AppConfigKeyboardShortcutKeys = keyof AppConfigModelSnapshot["keyboardShortcuts"];
