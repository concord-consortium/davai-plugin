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
// prompt documentation in sync automatically.
export const initializeLocalTools = (): void => {
  registerTools([
    getGraphInfoTool,
    getCaseValuesTool,
    getStatsTool,
    selectCasesTool,
    findCasesTool,
    createGraphTool,
    createAttributeTool,
    updateAttributeTool,
    updateGraphTool,
    createAdornmentTool,
    sonifyGraphTool,
    groupByTool,
  ]);
};
