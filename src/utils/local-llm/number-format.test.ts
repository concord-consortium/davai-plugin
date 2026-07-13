import { roundSig } from "./number-format";

// PR #114 review item 11: roundSig(NaN|±Infinity) rendered a bare "NaN"/"-NaN" — a screen reader
// would speak that as if it were a real number. A non-finite value can never be a meaningful
// magnitude, so it degrades to a plain "unavailable" instead.
describe("roundSig NaN/Infinity guard (PR #114 review item 11)", () => {
  it("renders NaN as 'unavailable', never the literal string 'NaN'", () => {
    expect(roundSig(NaN)).toBe("unavailable");
  });

  it("renders +Infinity as 'unavailable'", () => {
    expect(roundSig(Infinity)).toBe("unavailable");
  });

  it("renders -Infinity as 'unavailable', never '-NaN'", () => {
    expect(roundSig(-Infinity)).toBe("unavailable");
  });

  it("still rounds ordinary finite values normally (no regression)", () => {
    expect(roundSig(6277.8)).toBe("6280");
    expect(roundSig(0)).toBe("0");
    expect(roundSig(-0.02)).toBe("-0.02");
  });
});
