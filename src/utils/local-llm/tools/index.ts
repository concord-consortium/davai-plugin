import { registerTools } from "./registry";
import { getGraphInfoTool } from "./get-graph-info";
import { getCaseValuesTool } from "./get-case-values";
import { getStatsTool } from "./get-stats";
import { selectCasesTool } from "./select-cases";
import { createGraphTool } from "./create-graph";
import { createAttributeTool } from "./create-attribute";
import { createAdornmentTool } from "./create-adornment";
import { sonifyGraphTool } from "./sonify-graph";

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
    createGraphTool,
    createAttributeTool,
    createAdornmentTool,
    sonifyGraphTool,
  ]);
};
