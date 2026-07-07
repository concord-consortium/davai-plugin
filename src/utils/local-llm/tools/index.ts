import { registerTools } from "./registry";
import { getGraphInfoTool } from "./get-graph-info";
import { getCaseValuesTool } from "./get-case-values";
import { getStatsTool } from "./get-stats";
import { selectCasesTool } from "./select-cases";
import { findCasesTool } from "./find-cases";
import { createGraphTool } from "./create-graph";
import { createAttributeTool } from "./create-attribute";
import { updateAttributeTool } from "./update-attribute";
import { updateGraphTool } from "./update-graph";
import { createAdornmentTool } from "./create-adornment";
import { sonifyGraphTool } from "./sonify-graph";
import { groupByTool } from "./group-by";

export { dispatchTool, buildToolDocs } from "./registry";
export type { ILocalToolContext } from "./registry";

// Adding a curated tool = one new file above + one entry here; buildToolDocs() keeps the
// prompt documentation in sync automatically. Registration order IS prompt order (buildToolDocs
// walks the array in order), which is salience — DAVAI-126 matrix round 3 item E6 moves
// find_cases above get_case_values for exactly that reason (evidence: 3 of 4 live matrix runs
// answered a superlative lookup question via get_case_values/get_stats instead of find_cases,
// producing misaligned/wrong-unit answers; only the run where find_cases was more prominent used
// it, with a perfect one-call answer).
export const initializeLocalTools = (): void => {
  registerTools([
    getGraphInfoTool,
    findCasesTool,
    getCaseValuesTool,
    getStatsTool,
    selectCasesTool,
    createGraphTool,
    createAttributeTool,
    updateAttributeTool,
    updateGraphTool,
    createAdornmentTool,
    sonifyGraphTool,
    groupByTool,
  ]);
};
