import { codapInterface } from "@concord-consortium/codap-plugin-api";

interface IBinParams {
  binAlignment: number;
  numBins: number;
  minBinEdge: number;
  maxBinEdge: number;
  minValue: number;
  maxValue: number;
  totalNumberOfBins: number;
}

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

export const computeCodapBins = (values: number[]): IBinParams => {
  let minValue = Infinity;
  let maxValue = -Infinity;
  values.forEach(v => {
    if (Number.isFinite(v)) {
      minValue = Math.min(minValue, v);
      maxValue = Math.max(maxValue, v);
    }
  });

  const numBins = 10;
  const binAlignment = Math.floor(minValue / numBins) * numBins;
  const diff = binAlignment - minValue;
  const minBinEdge = binAlignment - Math.ceil(diff / numBins) * numBins;
  const totalNumberOfBins = Math.ceil((maxValue - minBinEdge) / numBins + 0.000001);
  const maxBinEdge = minBinEdge + (totalNumberOfBins * numBins);

  return {
    binAlignment,
    numBins,
    minBinEdge,
    maxBinEdge,
    minValue,
    maxValue,
    totalNumberOfBins
  };
};

export function binUsingCodapEdges(values: number[], binParams: IBinParams) {
  const {
    minBinEdge, maxBinEdge, numBins, totalNumberOfBins
  } = binParams;

  const bins = Array(totalNumberOfBins).fill(0);
  values.forEach((v) => {
    if (!Number.isFinite(v)) return;
    // clamp v so we don't go out of range
    if (v < minBinEdge) v = minBinEdge;
    if (v >= maxBinEdge) v = maxBinEdge - 1e-9; // so we fall in the last bin
    // figure out which bin
    const idx = Math.floor((v - minBinEdge) / numBins);
    if (idx >= 0 && idx < totalNumberOfBins) {
      bins[idx]++;
    }
  });
  return bins;
}

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
