import { codapInterface } from "@concord-consortium/codap-plugin-api";
import { ICODAPGraph } from "../types";
import { IAdornmentData } from "./codap-api-utils";

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

export const kLowerFreqBound = 220;
export const kUpperFreqBound = 880;
export const mapPitchFractionToFrequency = (pitchFraction: number) => {
  return kLowerFreqBound + pitchFraction * (kUpperFreqBound - kLowerFreqBound);
};

export const mapValueToStereoPan = (value: number, min: number, max: number) => {
  // Normalize value to a range of -1 (left) and 1 (right).
  const distanceFromMin = value - min;
  const totalRange = max - min;
  const normalizedPosition = distanceFromMin / totalRange;
  return normalizedPosition * 2 - 1;
};

export const interpolateBins = (bins: number[], stepCount: number): number[] => {
  const result: number[] = [];
  const n = bins.length;
  if (n === 0) return result;

  for (let i = 0; i < stepCount; i++) {
    // find the position in the bins array
    const pos = (i / stepCount) * (n - 1);
    const left = Math.floor(pos);
    const right = Math.ceil(pos);
    const t = pos - left;
    // linear interpolation between bins[left] and bins[right]
    const value = (1 - t) * bins[left] + t * bins[right];
    result.push(value);
  }
  return result;
};

export interface IAdornmentCue {
  label: string;
  timeOffset: number;
}

export const computeAdornmentCues = (
  adornments: IAdornmentData[],
  lowerBound: number,
  upperBound: number,
  duration: number
): IAdornmentCue[] => {
  const range = upperBound - lowerBound;
  if (range <= 0) return [];

  const cues: IAdornmentCue[] = [];

  const addCue = (label: string, value: number) => {
    if (!Number.isFinite(value)) return;
    const fraction = (value - lowerBound) / range;
    if (fraction < 0 || fraction > 1) return;
    cues.push({ label, timeOffset: fraction * duration });
  };

  const hasMeanAdornment = adornments.some(a => a.type === "Mean");

  for (const adornment of adornments) {
    switch (adornment.type) {
      case "Mean":
        if (adornment.value != null) addCue("mean", adornment.value);
        break;
      case "Median":
        if (adornment.value != null) addCue("median", adornment.value);
        break;
      case "Standard Deviation":
        if (adornment.min != null) addCue("SD lower", adornment.min);
        if (adornment.max != null) addCue("SD upper", adornment.max);
        if (!hasMeanAdornment && adornment.mean != null) addCue("mean", adornment.mean);
        break;
    }
  }

  return cues.sort((a, b) => a.timeOffset - b.timeOffset);
};

export const createRoiAdornment = async (graphId: number) => {
  await codapInterface.sendRequest({
    action: "create",
    resource: `component[${graphId}].adornment`,
    values: {
      type: "Region of Interest",
      primary: { "position": "0%", "extent": "0.05%" }, // 0.05% consistently approximates 1 pixel
      secondary: { "position": "0%", "extent": "100%" }
    }
  });
};


export const updateRoiAdornment = async (graphId: number, fraction: number) => {
  await codapInterface.sendRequest({
    action: "update",
    resource: `component[${graphId}].adornment`,
    values: {
      type: "Region of Interest",
      primary: { "position": `${fraction * 100}%`, "extent": "0.05%" } // 0.05% consistently approximates 1 pixel
    }
  });
};

export const removeRoiAdornment = async (graphId: number) => {
  await codapInterface.sendRequest({
    action: "delete",
    resource: `component[${graphId}].adornment`,
    values: { type: "Region of Interest" }
  });
};

export const speakLabel = (label: string) => {
  if (typeof speechSynthesis === "undefined") return;
  const utterance = new SpeechSynthesisUtterance(label);
  utterance.rate = 2;
  utterance.lang = "en-US";
  utterance.volume = 0.75;
  speechSynthesis.speak(utterance);
};
