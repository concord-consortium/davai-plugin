# Configuration Settings
Generated from source comments and MST runtime introspection. Do not edit manually.

| Key                              | Type     | Default                                     |
| -------------------------------- | -------- | ------------------------------------------- |
| dimensions.height                | number   | 680                                         |
| dimensions.width                 | number   | 380                                         |
| keyboardShortcuts.focusChatInput | string   | "Control+Shift+/"                           |
| keyboardShortcuts.sonifyGraph    | string   | "Control+Shift+."                           |
| keyboardShortcutsEnabled         | boolean  | true                                        |
| llmId                            | string   | "{\"id\":\"gpt-4o-mini\",\"provider\":\"OpenAI\"}" |
| llmList                          | frozen[] |                                             |
| mode                             | enum     | "production"                                |
| playbackSpeed                    | number   | 1                                           |
| playProcessingMessage            | boolean  | true                                        |
| playProcessingTone               | boolean  | false                                       |
| readAloudEnabled                 | boolean  | false                                       |
| showDebugLogInDevMode            | boolean  | true                                        |
| sonify.defaultNumBins            | number   | 14                                          |
| sonify.dotPlotEachDotPitch       | string   | "440"                                       |
| sonify.dotPlotMode               | enum     | "continual"                                 |
| sonify.maxPolyphony              | number   | 120                                         |
| sonify.pointDuration             | string   | "3i"                                        |
| sonify.synthReleaseTime          | number   | 0.24                                        |

## `dimensions.height`

Height of the plugin in CODAP (in pixels).

## `dimensions.width`

Width of the plugin in CODAP (in pixels).

## `keyboardShortcuts.focusChatInput`

The shortcut key combination to focus the chat input field. This is in tinykeys format.

## `keyboardShortcuts.sonifyGraph`

The shortcut key combination to play the graph sonification. This is in tinykeys format.

## `keyboardShortcutsEnabled`

Whether keyboard shortcuts are enabled. If false, keyboard shortcuts will be ignored.

## `llmId`

The unique ID of an LLM to use, or "mock" for a mocked LLM.
Note: for a real LLM it is a stringified JSON object, not just the ID from the llmList object.

## `mode`

**Allowed values:** development, production, test

The mode in which the application runs. Possible values:
- `"development"`: Enables additional UI for debugging and artifact maintenance.
- `"production"`: Standard runtime mode for end users.
- `"test"`: Specialized mode for automated testing.

## `showDebugLogInDevMode`

Whether to show the log of messages with the LLM when in development mode.

## `sonify.defaultNumBins`

The default number of bins to use for sonification of univariate graphs.
If set to 0, an automatic binning strategy that matches CODAP's
"Group into Bins" is used.

## `sonify.dotPlotEachDotPitch`

Fixed pitch for dot plot each-dot sonification. This is in tone.js format so can
be a frequency (e.g., "440") or note name (e.g., "A4").

## `sonify.dotPlotMode`

**Allowed values:** continual, each-dot

Whether to sonify points in a dot plot as individual dots with quick sharp tones,
or as a continual tone by binning the points and sonifying a smoothed line "drawn"
across the top of the bins.

## `sonify.maxPolyphony`

How many simultaneous sounds can be played during sonification. This value of 120
was chosen to support graphs with many points in a cluster. It hasn't been tested to see
how it affects performance.

## `sonify.pointDuration`

Duration of each note when sonifying points. The value is in Tone.js notation. "3i" means
3 ticks which by default is 0.0078s. The default attack time of the Synth envelope is 0.005s
so this point duration gives the note time reach its full volume before the release phase begins.

## `sonify.synthReleaseTime`

The release or "fade out" time after the duration of the note is over. Less than
0.1 causes a noise with lots of points which doesn't sound good.