/**
 * Utility routines having to do with graph entities.
 * This is copied from CODAP and modified to not depend on CODAP stuff.
 */

export type Point = { x: number, y: number };

/**
 * Returns an object that has the slope and intercept
 * @returns {count: {Number}, xSum: {Number}, xSumOfSquares: {Number}, xSumSquaredDeviations: { Number},
 *          ySum: {Number}, ySumOfSquares: {Number}, ySumSquaredDeviations: {Number}, sumOfProductDiffs: {Number} }
 * @param iCoordPairs
 */
const computeBivariateStats = (iCoordPairs: Point[]) => {
  const tResult = {
    count: 0,
    xMean: 0,
    xSum: 0,
    xSumOfSquares: 0,
    xSumSquaredDeviations: 0,
    yMean: 0,
    ySum: 0,
    ySumOfSquares: 0,
    ySumSquaredDeviations: 0,
    sumOfProductDiffs: 0
  };
  let tSumDiffsX = 0;
  let tSumDiffsY = 0;

  // Under certain circumstances (adding new case) an empty value can sneak in here. Filter out.
  iCoordPairs = iCoordPairs.filter((iPair: Point) => {
    return isFinite(iPair.x) && isFinite(iPair.y);
  });
  iCoordPairs.forEach(function (iPair: Point) {
    if (isFinite(iPair.x) && isFinite(iPair.y)) {
      tResult.count += 1;
      tResult.xSum += iPair.x;
      tResult.xSumOfSquares += (iPair.x * iPair.x);
      tResult.ySum += iPair.y;
      tResult.ySumOfSquares += (iPair.y * iPair.y);
    }
  });
  if (tResult.count > 0) {
    tResult.xMean = tResult.xSum / tResult.count;
    tResult.yMean = tResult.ySum / tResult.count;
    iCoordPairs.forEach((iPair: Point) => {
      let tDiffX = 0;
      let tDiffY = 0;
      if (isFinite(iPair.x) && isFinite(iPair.y)) {
        tResult.sumOfProductDiffs += (iPair.x - tResult.xMean) * (iPair.y - tResult.yMean);
        tDiffX = iPair.x - tResult.xMean;
        tResult.xSumSquaredDeviations += tDiffX * tDiffX;
        tSumDiffsX += tDiffX;
        tDiffY = iPair.y - tResult.yMean;
        tResult.ySumSquaredDeviations += tDiffY * tDiffY;
        tSumDiffsY += tDiffY;
      }
    });
    // Subtract a correction factor for roundoff error.
    // See Numeric Recipes in C, section 14.1 for details.
    tResult.xSumSquaredDeviations -= (tSumDiffsX * tSumDiffsX / tResult.count);
    tResult.ySumSquaredDeviations -= (tSumDiffsY * tSumDiffsY / tResult.count);
  }
  return tResult;
};

const t_quantile_at_0975_for_df = [
  [1, 12.7062],
  [2, 4.30265],
  [3, 3.18245],
  [4, 2.77645],
  [5, 2.57058],
  [6, 2.44691],
  [7, 2.36462],
  [8, 2.306],
  [9, 2.26216],
  [10, 2.22814],
  [11, 2.20099],
  [12, 2.17881],
  [13, 2.16037],
  [14, 2.14479],
  [15, 2.13145],
  [16, 2.11991],
  [17, 2.10982],
  [18, 2.10092],
  [19, 2.09302],
  [20, 2.08596],
  [21, 2.07961],
  [22, 2.07387],
  [23, 2.06866],
  [24, 2.0639],
  [25, 2.05954],
  [26, 2.05553],
  [27, 2.05183],
  [28, 2.04841],
  [29, 2.04523],
  [30, 2.04227],
  [40, 2.02108],
  [50, 2.00856],
  [60, 2.0003],
  [70, 1.99444],
  [80, 1.99006],
  [90, 1.98667],
  [100, 1.98397],
  [200, 1.9719],
  [500, 1.96472],
  [1000, 1.96234],
  [2000, 1.96115],
  [10000, 1.9602],
  [100000, 1.95999]
];

export const tAt0975ForDf = (iDf: number) => {
  const foundIndex = t_quantile_at_0975_for_df.findIndex((iPair: number[]) => iPair[0] > iDf);
  return foundIndex <= 0 ? 1.96 : t_quantile_at_0975_for_df[foundIndex - 1][1];
};
export interface IRegression {
  count?: number
  intercept?: number
  mse?: number // mean squared error
  rSquared?: number
  sdResiduals?: number
  slope?: number
  sse?: number // sum of squared errors
  sumSquaresResiduals?: number
  xMean?: number
  xSumSquaredDeviations?: number
  yMean?: number
}

export const leastSquaresLinearRegression = (iValues: Point[], iInterceptLocked: boolean) => {
  const tRegression: IRegression = {};
  const tBiStats = computeBivariateStats(iValues);
  if (tBiStats.count > 1) {
    if (iInterceptLocked) {
      tRegression.slope = (tBiStats.sumOfProductDiffs + tBiStats.xMean * tBiStats.ySum) /
          (tBiStats.xSumSquaredDeviations + tBiStats.xMean * tBiStats.xSum);
      tRegression.intercept = 0;
    } else {
      tRegression.count = tBiStats.count;
      tRegression.xMean = tBiStats.xMean;
      tRegression.yMean = tBiStats.yMean;
      tRegression.xSumSquaredDeviations = tBiStats.xSumSquaredDeviations;
      tRegression.slope = tBiStats.sumOfProductDiffs / tBiStats.xSumSquaredDeviations;
      tRegression.intercept = tBiStats.yMean - tRegression.slope * tBiStats.xMean;
      tRegression.rSquared = (tBiStats.sumOfProductDiffs * tBiStats.sumOfProductDiffs) /
          (tBiStats.xSumSquaredDeviations * tBiStats.ySumSquaredDeviations);

      // Now that we have the slope and intercept, we can compute the sum of squared errors
      iValues.forEach(function (iPair: Point) {
        if (isFinite(iPair.x) && isFinite(iPair.y)) {
          const tResidual = iPair.y - (Number(tRegression.intercept) + Number(tRegression.slope) * iPair.x);
          tRegression.sse = tRegression.sse
            ? tRegression.sse += tResidual * tResidual
            : tResidual * tResidual;
        }
      });
      tRegression.sdResiduals = Math.sqrt(Number(tRegression.sse) / (tBiStats.count - 2));
      tRegression.mse = Number(tRegression.sse) / (Number(tRegression.count) - 2);
    }
  }
  return tRegression;
};

// Perhaps this will be useful when doing a spline fit later?
// However we will need to convert it to a form that allows us to get y for a given x

// This is a modified version of CODAP V2's SvgScene.pathBasis which was extracted from protovis
export const pathBasis = (p0: Point, p1: Point, p2: Point, p3: Point) => {
  /**
   * Matrix to transform basis (b-spline) control points to bezier control
   * points. Derived from FvD 11.2.8.
   */
  const basis = [
    [ 1/6, 2/3, 1/6,   0 ],
    [   0, 2/3, 1/3,   0 ],
    [   0, 1/3, 2/3,   0 ],
    [   0, 1/6, 2/3, 1/6 ]
  ];

  /**
   * Returns the point that is the weighted sum of the specified control points,
   * using the specified weights. This method requires that there are four
   * weights and four control points.
   * We round to 2 decimal places to keep the length of path strings relatively short.
   */
  const weight = (w: number[]) => {
    return {
      x: Math.round((w[0] * p0.x + w[1] * p1.x + w[2] * p2.x + w[3] * p3.x) * 100) / 100,
      y: Math.round((w[0] * p0.y  + w[1] * p1.y  + w[2] * p2.y  + w[3] * p3.y) * 100) / 100
    };
  };

  const b1 = weight(basis[1]);
  const b2 = weight(basis[2]);
  const b3 = weight(basis[3]);

  return `C${b1.x} ${b1.y} ${b2.x} ${b2.y} ${b3.x} ${b3.y}`;
};

// This is a modified version of CODAP V2's SvgScene.curveBasis which was extracted from protovis
export const curveBasis = (points: Point[]) => {
  if (points.length <= 2) return "";
  let path = "",
      p0 = points[0],
      p1 = p0,
      p2 = p0,
      p3 = points[1];
  path += pathBasis(p0, p1, p2, p3);
  for (let i = 2; i < points.length; i++) {
    p0 = p1;
    p1 = p2;
    p2 = p3;
    p3 = points[i];
    path += pathBasis(p0, p1, p2, p3);
  }
  /* Cycle through to get the last point. */
  path += pathBasis(p1, p2, p3, p3);
  path += pathBasis(p2, p3, p3, p3);
  return path;
};
