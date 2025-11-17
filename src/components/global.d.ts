declare module "*.png";
declare module "*.svg";
declare module "*.scss";
declare module "loess" {
  interface LoessData { x: number[]; y: number[]; }
  interface LoessOptions { span?: number; degree?: number; }
  export default class Loess {
    constructor(data: LoessData, options?: LoessOptions);
    grid(args: number[] | [number]): number[];
    predict(xValues: number[] | { x: number[] }): {
      betas: number[][],
      fitted: number[],
      weights: number[][],
    };
  }
}
