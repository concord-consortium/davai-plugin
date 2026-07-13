import { roundSig } from "./number-format";

// A non-finite value can never be a meaningful magnitude; roundSig degrades it to a plain
// "unavailable" rather than a bare "NaN"/"-NaN" a screen reader would speak as if it were a real
// number.
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

// Two distinct crashes/bad-output modes at the extreme edges of the double range. (1)
// `toFixed(decimals)` throws a RangeError once `decimals` exceeds 100 — reachable for
// denormal-range values (e.g. ~1e-307), where expressing 3 significant figures in plain decimal
// needs hundreds of fractional digits, AND this module's own scale-multiply/divide arithmetic
// (10^roundingExponent) overflows to Infinity at that same magnitude, producing NaN before
// toFixed is even reached. (2) `toFixed` ALWAYS renders |value| >= 1e21 in exponential notation,
// regardless of the requested decimals — unspeakable/unreadable prose, and the literal opposite
// of this module's whole "never emit e-notation" purpose.
describe("roundSig extreme-magnitude hardening (Codex hardening F4)", () => {
  it("denormal-range values never throw a RangeError and never render exponential notation", () => {
    expect(() => roundSig(1e-307)).not.toThrow();
    expect(() => roundSig(2e-307)).not.toThrow();
    expect(roundSig(1e-307)).not.toMatch(/e/i);
    expect(roundSig(2e-307)).not.toMatch(/e/i);
    // Must still be a real (nonzero) rendering — not a silent collapse to "0" or a NaN leak.
    expect(roundSig(1e-307)).not.toBe("0");
    expect(roundSig(1e-307)).not.toBe("unavailable");
    expect(roundSig(1e-307)).not.toMatch(/NaN/i);
  });

  it("distinguishes 1e-307 from 2e-307 (both round correctly, not both collapsing to the same " +
    "string)", () => {
    expect(roundSig(1e-307)).not.toBe(roundSig(2e-307));
  });

  it("renders 1e21 in plain decimal, never 'e+21'", () => {
    expect(roundSig(1e21)).toBe("1000000000000000000000");
  });

  it("renders a negative value at the 1e21 boundary correctly signed, still no e-notation", () => {
    expect(roundSig(-1e21)).toBe("-1000000000000000000000");
  });

  it("still rounds ordinary finite values normally (no regression, extended fixture set)", () => {
    expect(roundSig(811.7598816718566)).toBe("812");
    expect(roundSig(-726.8757576652749)).toBe("-727");
    expect(roundSig(0.8871962819172852)).toBe("0.887");
    expect(roundSig(1234567.89, 6)).toBe("1234570");
  });
});
