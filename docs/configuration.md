# Configuration Settings
Generated from source comments and MST runtime introspection. Do not edit manually.

| Key                                     | Type     | Default                                     |
| --------------------------------------- | -------- | ------------------------------------------- |
| defaultNumBins                          | number   | 14                                          |
| dimensions.height                       | number   | 680                                         |
| dimensions.width                        | number   | 380                                         |
| keyboardShortcuts.focusChatInput        | string   | "Control+Shift+/"                           |
| keyboardShortcuts.playGraphSonification | string   | "Control+Shift+."                           |
| keyboardShortcutsEnabled                | boolean  | true                                        |
| llmId                                   | string   | "{\"id\":\"gpt-4o-mini\",\"provider\":\"OpenAI\"}" |
| llmList                                 | frozen[] |                                             |
| maxPolyphony                            | number   | 120                                         |
| mode                                    | enum     | "production"                                |
| playbackSpeed                           | number   | 1                                           |
| playProcessingMessage                   | boolean  | true                                        |
| playProcessingTone                      | boolean  | false                                       |
| pointNoteDuration                       | string   | "1i"                                        |
| readAloudEnabled                        | boolean  | false                                       |
| showDebugLogInDevMode                   | boolean  | true                                        |

## `defaultNumBins`

The default number of bins to use for sonification of univariate graphs.
If set to 0, an automatic binning strategy that matches CODAP's
"Group into Bins" is used.

## `dimensions.height`

Height of the plugin in CODAP (in pixels).

## `dimensions.width`

Width of the plugin in CODAP (in pixels).

## `keyboardShortcuts.focusChatInput`

The shortcut key combination to focus the chat input field. This is is tinykeys format.

## `keyboardShortcuts.playGraphSonification`

The shortcut key combination to play the graph sonification. This is is tinykeys format.

## `keyboardShortcutsEnabled`

Whether keyboard shortcuts are enabled. If false, keyboard shortcuts will be ignored.

## `llmId`

The unique ID of an LLM to use, or "mock" for a mocked LLM.
Note: for a real LLM it is a stringified JSON object, not just the ID from the llmList object.

## `maxPolyphony`

How many simultaneous sounds can be played during sonification. This value of 120
was chosen to support graphs with many points in a cluster. It hasn't been tested to see
how it affects performance.

## `mode`

**Allowed values:** development, production, test

The mode in which the application runs. Possible values:
- `"development"`: Enables additional UI for debugging and artifact maintenance.
- `"production"`: Standard runtime mode for end users.
- `"test"`: Specialized mode for automated testing.

## `pointNoteDuration`

Duration of each note when sonifying points. The value is in Tone.js notation. The default is
"1i", which is supposed to be the shortest possible duration.

## `showDebugLogInDevMode`

Whether to show the log of messages with the LLM when in development mode.