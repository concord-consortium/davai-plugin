# Configuration Settings
Generated from source comments and MST runtime introspection. Do not edit manually.

| Key                                     | Type     | Default              | Allowed / Enum |
| --------------------------------------- | -------- | -------------------- | -------------- |
| defaultNumBins                          | number   | 14                   |                |
| dimensions.height                       | number   | 680                  |                |
| dimensions.width                        | number   | 380                  |                |
| keyboardShortcuts.focusChatInput        | string   | "Control+Shift+/"    |                |
| keyboardShortcuts.playGraphSonification | string   | "Control+Shift+."    |                |
| keyboardShortcutsEnabled                | boolean  | true                 |                |
| llmId                                   | string   | "{\"id\":\"gpt-4o-mini\",\"provider\":\"OpenAI\"}" |                |
| llmList                                 | frozen[] |                      |                |
| maxPolyphony                            | number   | 120                  |                |
| mode                                    | Mode     | "production"         |                |
| playbackSpeed                           | number   | 1                    |                |
| playProcessingMessage                   | boolean  | true                 |                |
| playProcessingTone                      | boolean  | false                |                |
| pointNoteDuration                       | string   | "1i"                 |                |
| readAloudEnabled                        | boolean  | false                |                |
| showDebugLogInDevMode                   | boolean  | true                 |                |

## `defaultNumBins`

The default number of bins to use for sonification of univariate graphs.
If set to 0, an automatic binning strategy that matches CODAP's
"Group into Bins" is used.

## `maxPolyphony`

How many simultaneous sounds can be played during sonification. This value of 120
was chosen to support graphs with many points in a cluster. It hasn't been tested to see
how it affects performance.

## `pointNoteDuration`

Duration of each note when sonifying points. The value is in Tone.js notation. The default is
"1i", which is supposed to be the shortest possible duration.