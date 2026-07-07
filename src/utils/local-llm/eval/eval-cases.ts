export interface IEvalCase {
  id: string;
  prompt: string;
  // allowOnly: every tool call the turn makes must be in this list (zero calls also passes) —
  // for prompts where a redundant-but-harmless fetch (the model re-confirming data it already
  // had) shouldn't fail the case the way a strict `none` or `exactly` would.
  expectTools: { exactly?: string[]; contains?: string[]; none?: boolean; allowOnly?: string[] };
  expectFinal: { matches?: RegExp[]; notMatches?: RegExp[] };
}

// Fixture: open CODAP's Mammals sample document, create a dot plot of Height, select it.
export const evalCases: IEvalCase[] = [
  // DAVAI-126 eval round 2 item A: every matrix run called get_graph_info then answered
  // correctly — a redundant-but-harmless fetch (the seed already has the data), so allowOnly
  // (rather than a strict `none`) doesn't fail a model for double-checking. Grounding is also
  // strengthened to a specific value from the Mammals/Height fixture, not just the word "height".
  { id: "describe-graph", prompt: "Describe this graph.",
    expectTools: { allowOnly: ["get_graph_info"] },
    expectFinal: { matches: [/height/i, /27|0\.1|6\.5/], notMatches: [/error|sorry/i] } },
  { id: "mean", prompt: "What is the mean height?",
    expectTools: { contains: ["get_stats"] }, expectFinal: { matches: [/mean/i, /\d/] } },
  { id: "median", prompt: "What's the median of Height?",
    expectTools: { contains: ["get_stats"] }, expectFinal: { matches: [/median/i, /\d/] } },
  { id: "raw-values", prompt: "List the values of Mass.",
    expectTools: { contains: ["get_case_values"] }, expectFinal: { matches: [/\d/] } },
  // DAVAI-126 eval round 2 item A: the prompt never asked for a count, but the regex below
  // demands one — asking closes that gap (regexes unchanged).
  { id: "selection-percentile",
    prompt: "Select the mammals above the 75th percentile of Height, and tell me how many you selected.",
    expectTools: { contains: ["select_cases"] }, expectFinal: { matches: [/select/i, /\d+\s*(cases?|mammals?)/i] } },
  { id: "create-graph", prompt: "Make a graph of Height versus Mass.",
    expectTools: { contains: ["create_graph"] }, expectFinal: { matches: [/graph|plot/i], notMatches: [/fail/i] } },
  // DAVAI-126 Task A: exercises resolveGraph's rung 3 (axis + plot-type matching). create-graph
  // (above) makes a graph titled "Height vs Mass" — this prompt flips the word order to "Mass vs
  // Height", so title normalization alone cannot match it; only axis-substring scoring can. Case
  // ORDER matters here: this must run after create-graph creates the graph and before any case
  // that would create another graph sharing both axis names.
  // DAVAI-126 Task B: /\d/ added — get_graph_info now appends a client-computed sketch (range,
  // clustering, relationship), so a correct answer should ground in an actual number.
  { id: "describe-by-axes", prompt: "Describe the Mass vs Height graph.",
    expectTools: { contains: ["get_graph_info"] },
    expectFinal: { matches: [/mass/i, /height/i, /\d/], notMatches: [/error|sorry/i] } },
  // DAVAI-126 eval round 2 item A: the case's own arithmetic was wrong — Height is in meters,
  // and /30.48 is the cm-to-feet divisor, not a meters-to-feet conversion. Models obeyed the
  // (wrong) instruction faithfully; the fix is the prompt, not the model. Assertions unchanged.
  { id: "create-attribute-formula", prompt: "Add an attribute called HeightInFeet computed as Height times 3.281.",
    expectTools: { contains: ["create_attribute"] }, expectFinal: { matches: [/HeightInFeet/i] } },
  // DAVAI-126 eval round 2 item A: "the graph" is ambiguous once create-graph (above) has run —
  // the sonification store auto-selects the newest graph, so "the graph" resolved to the
  // Height-vs-Mass scatterplot, where Mean is legitimately unavailable (a 4B refusal there was
  // correct behavior, not a model failure). Naming the graph removes the ambiguity. Assertions
  // unchanged.
  { id: "create-adornment", prompt: "Add a mean line to the Height graph.",
    expectTools: { contains: ["create_adornment"] }, expectFinal: { matches: [/mean/i, /\d/] } },
  { id: "sonify", prompt: "Play this graph as sound.",
    expectTools: { contains: ["sonify_graph"] }, expectFinal: { matches: [/sonif/i] } },
  { id: "unsupported-intent", prompt: "Export this dataset to Excel.",
    expectTools: { none: true }, expectFinal: { matches: [/can(no|')t|not able|server model/i] } },
  { id: "miscapitalized-attribute", prompt: "what is the mean of hieght?",   // misspelled + lowercase on purpose
    expectTools: { contains: ["get_stats"] }, expectFinal: { matches: [/mean/i, /\d/] } },
];
