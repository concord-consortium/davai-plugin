// Shared plain-decimal, no-exponential-notation number formatting for spoken/prompt text.
// Extracted from graph-sketch.ts (which re-exports it, so existing imports are unaffected) so
// get-stats.ts can reuse the exact same never-e-notation guarantee for potentially large/small
// means without get-stats.ts <-> graph-sketch.ts becoming a circular import (graph-sketch.ts
// already imports coerceNumericValues FROM get-stats.ts).

// Expands a JS exponential-notation string (e.g. "1.23e-307", "1.00e+21") into a plain decimal
// string with no exponent. Used only for the two magnitudes roundSig's own scale-multiply/divide
// arithmetic and toFixed cannot express directly (see the two call sites below); toPrecision/
// toExponential round correctly at any finite magnitude without this module's arithmetic
// overflowing, so this only ever has to reformat their ALREADY-correctly-rounded digits, never
// re-round anything itself.
const expandExponential = (expStr: string): string => {
  const m = /^(-?)(\d)(?:\.(\d+))?e([+-]\d+)$/.exec(expStr);
  if (!m) return expStr;
  const [, sign, lead, frac = "", expPart] = m;
  const exp = Number(expPart);
  const digits = lead + frac;
  if (exp >= digits.length - 1) return sign + digits + "0".repeat(exp - digits.length + 1);
  if (exp >= 0) return sign + digits.slice(0, exp + 1) + "." + digits.slice(exp + 1);
  return sign + "0." + "0".repeat(-exp - 1) + digits;
};

// Round to N significant figures, formatted as a plain (non-exponential) decimal string, with
// trailing zeros after the decimal point trimmed. `toPrecision`/`toExponential` alone would
// render values like 6277.8 as "6.28e+3", which reads badly in prose — this never does that.
// NaN/±Infinity guard: a non-finite value can never be rendered as a meaningful magnitude —
// return "unavailable" rather than the literal string "NaN"/"-NaN" a screen reader would
// otherwise speak as if it were a real number.
export const roundSig = (n: number, sig = 3): string => {
  if (!Number.isFinite(n)) return "unavailable";
  if (n === 0) return "0";
  const negative = n < 0;
  const abs = Math.abs(n);
  const magnitude = Math.floor(Math.log10(abs));
  // The exponent can be negative (magnitude >= sig, e.g. 6277.8 at 3 sig figs needs rounding to
  // the nearest 10 — a NEGATIVE decimal-places count, which toFixed cannot express directly), so
  // round via a scale/round/unscale on the unclamped exponent, and clamp only for the final
  // toFixed call (which needs a non-negative digit count to format the result as plain decimal).
  const roundingExponent = sig - 1 - magnitude;
  let s: string;
  // At denormal-range magnitudes (e.g. ~1e-307), expressing `sig` significant figures needs more
  // than 100 fractional digits — toFixed rejects any digit count over 100 outright (RangeError),
  // and 10^roundingExponent itself overflows to Infinity at this magnitude, poisoning the
  // scale/round arithmetic below into NaN before toFixed is even reached. toPrecision has no such
  // overflow at any finite magnitude, so use it instead here.
  if (roundingExponent > 100) {
    s = expandExponential(abs.toPrecision(sig));
  } else {
    const scale = Math.pow(10, roundingExponent);
    const rounded = Math.round(abs * scale) / scale;
    if (Math.abs(rounded) >= 1e21) {
      // toFixed ALWAYS renders |value| >= 1e21 in exponential notation regardless of the
      // requested decimals, even though scale/rounded above computed without overflow — expand
      // manually instead. toExponential's own digit-count argument (not the scale/round pair
      // above) is what actually determines the rendered significant figures here.
      s = expandExponential(rounded.toExponential(Math.max(0, sig - 1)));
    } else {
      const decimals = Math.max(0, roundingExponent);
      s = rounded.toFixed(decimals);
    }
  }
  if (s.includes(".")) s = s.replace(/0+$/, "").replace(/\.$/, "");
  return (negative ? "-" : "") + s;
};
