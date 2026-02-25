import { computeAdornmentCues } from "./graph-sonification-utils";
import { IAdornmentData } from "./codap-api-utils";

describe("computeAdornmentCues", () => {
  const duration = 5; // 5 second sonification

  it("should compute a cue for mean at the correct time offset", () => {
    const adornments: IAdornmentData[] = [
      { type: "Mean", isVisible: true, value: 15 }
    ];
    const cues = computeAdornmentCues(adornments, 10, 20, duration);
    expect(cues).toEqual([
      { label: "mean", timeOffset: 2.5 } // (15-10)/(20-10) * 5 = 2.5
    ]);
  });

  it("should compute a cue for median at the correct time offset", () => {
    const adornments: IAdornmentData[] = [
      { type: "Median", isVisible: true, value: 12 }
    ];
    const cues = computeAdornmentCues(adornments, 10, 20, duration);
    expect(cues).toEqual([
      { label: "median", timeOffset: 1 } // (12-10)/(20-10) * 5 = 1
    ]);
  });

  it("should compute cues for SD lower and upper bounds", () => {
    const adornments: IAdornmentData[] = [
      { type: "Mean", isVisible: true, value: 15 },
      { type: "Standard Deviation", isVisible: true, min: 12, max: 18, mean: 15 }
    ];
    const cues = computeAdornmentCues(adornments, 10, 20, duration);
    expect(cues).toHaveLength(3);
    expect(cues[0]).toEqual({ label: "SD lower", timeOffset: 1 }); // (12-10)/10 * 5
    expect(cues[1]).toEqual({ label: "mean", timeOffset: 2.5 });          // (15-10)/10 * 5
    expect(cues[2]).toEqual({ label: "SD upper", timeOffset: 4 });  // (18-10)/10 * 5
  });

  it("should voice mean from SD data when Mean adornment is not present", () => {
    const adornments: IAdornmentData[] = [
      { type: "Standard Deviation", isVisible: true, min: 12, max: 18, mean: 15 }
    ];
    const cues = computeAdornmentCues(adornments, 10, 20, duration);
    expect(cues).toHaveLength(3);
    expect(cues[0]).toEqual({ label: "SD lower", timeOffset: 1 });
    expect(cues[1]).toEqual({ label: "mean", timeOffset: 2.5 });
    expect(cues[2]).toEqual({ label: "SD upper", timeOffset: 4 });
  });

  it("should not duplicate mean when both Mean and SD adornments are present", () => {
    const adornments: IAdornmentData[] = [
      { type: "Mean", isVisible: true, value: 15 },
      { type: "Standard Deviation", isVisible: true, min: 12, max: 18, mean: 15 }
    ];
    const cues = computeAdornmentCues(adornments, 10, 20, duration);
    const meanCues = cues.filter(c => c.label === "mean");
    expect(meanCues).toHaveLength(1);
  });

  it("should skip adornment values outside the axis bounds", () => {
    const adornments: IAdornmentData[] = [
      { type: "Mean", isVisible: true, value: 5 },   // below lower bound
      { type: "Median", isVisible: true, value: 25 }  // above upper bound
    ];
    const cues = computeAdornmentCues(adornments, 10, 20, duration);
    expect(cues).toEqual([]);
  });

  it("should skip only the out-of-bounds SD cues, keeping in-bounds ones", () => {
    const adornments: IAdornmentData[] = [
      { type: "Standard Deviation", isVisible: true, min: 5, max: 15, mean: 10 }
    ];
    // min=5 is below lower bound of 10, so "SD lower" should be skipped
    const cues = computeAdornmentCues(adornments, 10, 20, duration);
    expect(cues).toHaveLength(2);
    const labels = cues.map(c => c.label);
    expect(labels).not.toContain("SD lower");
    expect(labels).toContain("mean");
    expect(cues.find(c => c.label === "mean")?.timeOffset).toBeCloseTo(0);
    expect(labels).toContain("SD upper");
    expect(cues.find(c => c.label === "SD upper")?.timeOffset).toBeCloseTo(2.5);
  });

  it("should return an empty array when no adornments are provided", () => {
    const cues = computeAdornmentCues([], 10, 20, duration);
    expect(cues).toEqual([]);
  });

  it("should return an empty array when range is zero", () => {
    const adornments: IAdornmentData[] = [
      { type: "Mean", isVisible: true, value: 10 }
    ];
    const cues = computeAdornmentCues(adornments, 10, 10, duration);
    expect(cues).toEqual([]);
  });

  it("should return cues sorted by time offset", () => {
    const adornments: IAdornmentData[] = [
      { type: "Median", isVisible: true, value: 18 },
      { type: "Mean", isVisible: true, value: 12 }
    ];
    const cues = computeAdornmentCues(adornments, 10, 20, duration);
    expect(cues[0].label).toBe("mean");
    expect(cues[1].label).toBe("median");
    expect(cues[0].timeOffset).toBeLessThan(cues[1].timeOffset);
  });

  it("should include adornments at exact boundary values", () => {
    const adornments: IAdornmentData[] = [
      { type: "Mean", isVisible: true, value: 10 },  // at lower bound (fraction = 0)
      { type: "Median", isVisible: true, value: 20 }  // at upper bound (fraction = 1)
    ];
    const cues = computeAdornmentCues(adornments, 10, 20, duration);
    expect(cues).toHaveLength(2);
    expect(cues[0]).toEqual({ label: "mean", timeOffset: 0 });
    expect(cues[1]).toEqual({ label: "median", timeOffset: 5 });
  });

  it("should skip adornments with null or undefined values", () => {
    const adornments: IAdornmentData[] = [
      { type: "Mean", isVisible: true, value: undefined },
      { type: "Median", isVisible: true }
    ];
    const cues = computeAdornmentCues(adornments, 10, 20, duration);
    expect(cues).toEqual([]);
  });
});
