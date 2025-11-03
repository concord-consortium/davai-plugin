import { getEnv, Instance, types } from "mobx-state-tree";
import { isAppConfig } from "./app-config-model";

// note: this binning logic is taken from CODAP itself, since the API doesn't support binning directly
// the original code can be found here:
// https://github.com/concord-consortium/codap/blob/main/v3/src/components/graph/plots/binned-dot-plot/binned-dot-plot-model.ts#L61
export const BinModel = types.model("BinModel", {
  values: types.optional(types.array(types.number), []),
})
.views((self) => ({
  get minValue() {
    if (self.values.length === 0) return 0;
    return Math.min(...self.values);
  },
  get maxValue() {
    if (self.values.length === 0) return 0;
    return Math.max(...self.values);
  },
  get appConfig() {
    const env = getEnv(self);
    if (!env || !env.appConfig) {
      throw new Error("AppConfig not found in environment");
    }
    const { appConfig } = env;
    if (!isAppConfig(appConfig)) {
      throw new Error("appConfig in environment is not of type AppConfigModelType");
    }
    return appConfig;
  }
}))
.views((self) => ({
  get binWidth () {
    const { defaultNumBins } = self.appConfig.sonify;
    if (defaultNumBins) {
      // We subtract 1 because the calculations that result in totalNumberOfBins
      // often result in adding an extra bin.
      const numBins = defaultNumBins > 1 ? defaultNumBins - 1 : 1;
      return (self.maxValue - self.minValue) / numBins;
    }

    const kNumBins = 4;
    const binRange = self.maxValue !== self.minValue
      ? (self.maxValue - self.minValue) / kNumBins
      : 1 / kNumBins;
    // Convert to a logarithmic scale (base 10)
    const logRange = Math.log(binRange) / Math.LN10;
    const significantDigit = Math.pow(10.0, Math.floor(logRange));
    // Determine the scale factor based on the significant digit
    const scaleFactor = Math.pow(10.0, logRange - Math.floor(logRange));
    const adjustedScaleFactor = scaleFactor < 2 ? 1 : scaleFactor < 5 ? 2 : 5;
    return Math.max(significantDigit * adjustedScaleFactor, Number.MIN_VALUE);
  }
}))
.views((self) => ({
  get minBinEdge() {
    if (self.values.length === 0) return 0;
    const binAlignment = Math.floor(self.minValue / self.binWidth) * self.binWidth;
    const diff = binAlignment - self.minValue;
    return binAlignment - Math.ceil(diff / self.binWidth) * self.binWidth;
  }
}))
.views((self) => ({
  get totalNumberOfBins() {
    if (self.values.length === 0) return 0;
    return Math.ceil((self.maxValue - self.minBinEdge) / self.binWidth + 0.000001);
  }
}))
.views((self) => ({
  get maxBinEdge() {
    return self.minBinEdge + (self.totalNumberOfBins * self.binWidth);
  }
}))
.views((self) => ({
  get bins() {
    if (!self.values || self.values.length === 0) return [];
    const bins = Array(self.totalNumberOfBins).fill(0);
    self.values.forEach((v) => {
      if (!Number.isFinite(v)) return;
      // clamp v so we don't go out of range
      if (v < self.minBinEdge) v = self.minBinEdge;
      if (v >= self.maxBinEdge) v = self.maxBinEdge - 1e-9; // so we fall in the last bin
      const idx = Math.floor((v - self.minBinEdge) / self.binWidth);
      if (idx >= 0 && idx < self.totalNumberOfBins) {
        bins[idx]++;
      }
    });
    return bins;
  }
}))
.actions((self) => ({
  setValues(values: number[]) {
    self.values?.replace(values);
  }
}));

export interface IBinModel extends Instance<typeof BinModel> {}
