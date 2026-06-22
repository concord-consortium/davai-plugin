import { formatElapsedTime } from "./utils";

describe("formatElapsedTime", () => {
  it("formats whole and fractional seconds to 2 decimals with a unit", () => {
    expect(formatElapsedTime(4234)).toBe("4.23 s");
  });

  it("formats sub-second durations with a leading zero", () => {
    expect(formatElapsedTime(850)).toBe("0.85 s");
  });

  it("formats zero", () => {
    expect(formatElapsedTime(0)).toBe("0.00 s");
  });

  it("formats large durations", () => {
    expect(formatElapsedTime(60000)).toBe("60.00 s");
  });
});
