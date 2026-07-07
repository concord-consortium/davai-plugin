export interface IEvalCase {
  id: string;
  prompt: string;
  expectTools: { exactly?: string[]; contains?: string[]; none?: boolean };
  expectFinal: { matches?: RegExp[]; notMatches?: RegExp[] };
}

// Fixture: open CODAP's Mammals sample document, create a dot plot of Height, select it.
export const evalCases: IEvalCase[] = [
  { id: "describe-graph", prompt: "Describe this graph.",
    expectTools: { none: true }, expectFinal: { matches: [/height/i], notMatches: [/error|sorry/i] } },
  { id: "mean", prompt: "What is the mean height?",
    expectTools: { contains: ["get_stats"] }, expectFinal: { matches: [/mean/i, /\d/] } },
  { id: "median", prompt: "What's the median of Height?",
    expectTools: { contains: ["get_stats"] }, expectFinal: { matches: [/median/i, /\d/] } },
  { id: "raw-values", prompt: "List the values of Mass.",
    expectTools: { contains: ["get_case_values"] }, expectFinal: { matches: [/\d/] } },
  { id: "selection-percentile", prompt: "Select the mammals above the 75th percentile of Height.",
    expectTools: { contains: ["select_cases"] }, expectFinal: { matches: [/select/i, /\d+\s*(cases?|mammals?)/i] } },
  { id: "create-graph", prompt: "Make a graph of Height versus Mass.",
    expectTools: { contains: ["create_graph"] }, expectFinal: { matches: [/graph|plot/i], notMatches: [/fail/i] } },
  { id: "create-attribute-formula", prompt: "Add an attribute called HeightInFeet computed as Height divided by 30.48.",
    expectTools: { contains: ["create_attribute"] }, expectFinal: { matches: [/HeightInFeet/i] } },
  { id: "create-adornment", prompt: "Add a mean line to the graph.",
    expectTools: { contains: ["create_adornment"] }, expectFinal: { matches: [/mean/i, /\d/] } },
  { id: "sonify", prompt: "Play this graph as sound.",
    expectTools: { contains: ["sonify_graph"] }, expectFinal: { matches: [/sonif/i] } },
  { id: "unsupported-intent", prompt: "Export this dataset to Excel.",
    expectTools: { none: true }, expectFinal: { matches: [/can(no|')t|not able|server model/i] } },
  { id: "miscapitalized-attribute", prompt: "what is the mean of hieght?",   // misspelled + lowercase on purpose
    expectTools: { contains: ["get_stats"] }, expectFinal: { matches: [/mean/i, /\d/] } },
];
