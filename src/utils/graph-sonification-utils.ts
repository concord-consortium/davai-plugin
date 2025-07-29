import { codapInterface } from "@concord-consortium/codap-plugin-api";
import { ICODAPGraph } from "../types";

export function isUnivariateDotPlot(graph: ICODAPGraph): boolean {
  const {
    plotType,
    topSplitAttributeID: topId,
    rightSplitAttributeID: rightId,
    y2AttributeID: y2Id,
    xAttributeID: xId,
    yAttributeID: yId
  } = graph;

  const isDotPlot = plotType === "dotPlot" || plotType === "binnedDotPlot";
  const hasExactlyOneAxis = (xId && !yId) || (yId && !xId);

  return !!(isDotPlot
    && !topId
    && !rightId
    && !y2Id
    && hasExactlyOneAxis);
}

function isUnsplitScatterPlot(graph: ICODAPGraph): boolean {
  return graph.plotType === "scatterPlot" &&
         !graph.topSplitAttributeID &&
         !graph.rightSplitAttributeID;
}

export const isGraphSonifiable = (graph: ICODAPGraph): boolean => {
  return isUnsplitScatterPlot(graph) || isUnivariateDotPlot(graph);
};

export const mapPitchFractionToFrequency = (pitchFraction: number) => {
  const lowerFreqBound = 220;
  const upperFreqBound = 880;
  return lowerFreqBound + pitchFraction * (upperFreqBound - lowerFreqBound);
};

export const mapValueToStereoPan = (value: number, min: number, max: number) => {
  // Normalize value to a range of -1 (left) and 1 (right).
  const distanceFromMin = value - min;
  const totalRange = max - min;
  const normalizedPosition = distanceFromMin / totalRange;
  return normalizedPosition * 2 - 1;
};

export const updateRoiAdornment = async (graphName: string, fraction: number) => {
  await codapInterface.sendRequest({
    action: "update",
    resource: `component[${graphName}].adornment`,
    values: {
      type: "Region of Interest",
      primary: { "position": `${fraction * 100}%`, "extent": "0.05%" } // 0.05% consistently approximates 1 pixel
    }
  });
};

export const removeRoiAdornment = async (graphId: string) => {
  await codapInterface.sendRequest({
    action: "delete",
    resource: `component[${graphId}].adornment`,
    values: { type: "Region of Interest" }
  });
};
