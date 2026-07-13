// Shared plain-decimal, no-exponential-notation number formatting for spoken/prompt text.
// Extracted from graph-sketch.ts (which re-exports it, so existing imports are unaffected) so
// get-stats.ts can reuse the exact same never-e-notation guarantee for potentially large/small
// means without get-stats.ts <-> graph-sketch.ts becoming a circular import (graph-sketch.ts
// already imports coerceNumericValues FROM get-stats.ts).

// Round to N significant figures, formatted as a plain (non-exponential) decimal string, with
// trailing zeros after the decimal point trimmed. `toPrecision`/`toExponential` alone would
// render values like 6277.8 as "6.28e+3", which reads badly in prose — this never does that.
// NaN/±Infinity guard (PR #114 review item 11): a non-finite value can never be rendered as a
// meaningful magnitude — return "unavailable" rather than the literal string "NaN"/"-NaN" a
// screen reader would otherwise speak as if it were a real number.
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
  const scale = Math.pow(10, roundingExponent);
  const rounded = Math.round(abs * scale) / scale;
  const decimals = Math.max(0, roundingExponent);
  let s = rounded.toFixed(decimals);
  if (s.includes(".")) s = s.replace(/0+$/, "").replace(/\.$/, "");
  return (negative ? "-" : "") + s;
};
