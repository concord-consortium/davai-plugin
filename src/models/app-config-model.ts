import { types, Instance, SnapshotIn, SnapshotOut, TypeOfValue, getType, isStateTreeNode, getEnv, IAnyStateTreeNode } from "mobx-state-tree";
import { AppMode, AppModeValues } from "../types";

// Selects keys from T whose values are boolean
type BooleanKeys<T> = {
  [K in keyof T]: T[K] extends boolean ? K : never
}[keyof T];

// An "enumeration" for dot plot sonification modes
// Typescript enum is not used so this can work with node.js' built in basic type stripping
export const DotPlotMode = {
  CONTINUAL: "continual",
  EACH_DOT: "each-dot"
} as const;
export type DotPlotMode = typeof DotPlotMode[keyof typeof DotPlotMode];
export const DotPlotModeValues = Object.values(DotPlotMode);
export const isDotPlotMode = (value: unknown): value is DotPlotMode => {
  return DotPlotModeValues.includes(value as DotPlotMode);
};

const SonifyOptions = types.model("SonifyOptions", {
  /**
   * The default number of bins to use for sonification of univariate graphs.
   * If set to 0, an automatic binning strategy that matches CODAP's
   * "Group into Bins" is used.
   */
  defaultNumBins: 14,
  /**
   * How many simultaneous sounds can be played during sonification. This value of 200
   * was chosen to support graphs with many points in a cluster. It hasn't been tested to see
   * how it affects performance.
   */
  maxPolyphony: 200,
  /**
   * Duration of each note when sonifying points. The value is in Tone.js notation. "3i" means
   * 3 ticks which by default is 0.0078s. The default attack time of the Synth envelope is 0.005s
   * so this point duration gives the note time reach its full volume before the release phase begins.
   */
  pointDuration: "3i",
  /**
   * Whether to sonify points in a dot plot as individual dots with quick sharp tones,
   * or as a continual tone by binning the points and sonifying a smoothed line "drawn"
   * across the top of the bins.
   */
  dotPlotMode: types.enumeration<DotPlotMode>("DotPlotMode", DotPlotModeValues),
  /**
   * Fixed pitch for dot plot each-dot sonification. This is in tone.js format so can
   * be a frequency (e.g., "440") or note name (e.g., "A4").
   */
  dotPlotEachDotPitch: "440",
  /**
   * The release or "fade out" time after the duration of the note is over. Less than
   * 0.1 causes a noise with lots of points which doesn't sound good.
   */
  synthReleaseTime: 0.24,
  /**
   * Whether each dot in a scatter plot gets its own quick sharp tone.
   */
  scatterPlotEachDot: true,
  /**
   * Play continual tone following the least squares regression line (LSRL) for the points
   * in a scatter plot.
   */
  scatterPlotLSRL: false,
})
.actions((self) => ({
  setDotPlotMode(mode: string) {
    if (!isDotPlotMode(mode)) {
      throw new Error(`Invalid dotPlotMode: ${mode}`);
    }
    self.dotPlotMode = mode;
  },
  setScatterPlotEachDot(value: boolean) {
    self.scatterPlotEachDot = value;
  },
  setScatterPlotLSRL(value: boolean) {
    self.scatterPlotLSRL = value;
  }
}));

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
    /**
     * The shortcut key combination to focus the chat input field. This is in tinykeys format.
     */
    focusChatInput: types.string,
    /**
     * The shortcut key combination to play the graph sonification. This is in tinykeys format.
     */
    sonifyGraph: types.string,
  }),
  /**
   * Whether keyboard shortcuts are enabled. If false, keyboard shortcuts will be ignored.
   */
  keyboardShortcutsEnabled: types.boolean,
  playProcessingMessage: types.boolean,
  playProcessingTone: types.boolean,
  playbackSpeed: types.number,
  readAloudEnabled: types.boolean,
  /**
   * The unique ID of an LLM to use, or "mock" for a mocked LLM.
   * Note: for a real LLM it is a stringified JSON object, not just the ID from the llmList object.
   */
  llmId: types.string,
  llmList: types.array(types.frozen()),
  dimensions: types.model({
    /**
     * Width of the plugin in CODAP (in pixels).
     */
    width: types.number,
    /**
     * Height of the plugin in CODAP (in pixels).
     */
    height: types.number,
  }),
  /**
   * The mode in which the application runs. Possible values:
   * - `"development"`: Enables additional UI for debugging and artifact maintenance.
   * - `"production"`: Standard runtime mode for end users.
   * - `"test"`: Specialized mode for automated testing.
   */
  mode: types.enumeration<AppMode>("Mode", AppModeValues),
  /**
   * Whether to show the log of messages with the LLM when in development mode.
   */
  showDebugLogInDevMode: true,

  sonify: SonifyOptions
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

export function getEnvAppConfig(self: IAnyStateTreeNode): AppConfigModelType {
  const env = getEnv(self);
  if (!env || !env.appConfig) {
    throw new Error("AppConfig not found in environment");
  }
  const { appConfig } = env;
  if (!isAppConfig(appConfig)) {
    throw new Error("appConfig in environment is not of type AppConfigModelType");
  }
  return appConfig;
}

export type AppConfigToggleOptions = Parameters<AppConfigModelType["toggleOption"]>[0];
export type AppConfigKeyboardShortcutKeys = keyof AppConfigModelSnapshot["keyboardShortcuts"];
