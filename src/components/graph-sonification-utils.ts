import { codapInterface } from "@concord-consortium/codap-plugin-api";

export const mapPitchFractionToFrequency = (pitchFraction: number) => {
  if (pitchFraction === 0) {
    return 0;
  } else {
    const lowerFreqBound = 220;
    const upperFreqBound = 880;
    return lowerFreqBound + pitchFraction * (upperFreqBound - lowerFreqBound);
  }
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
