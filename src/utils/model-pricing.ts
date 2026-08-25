// Bundled list-price table for the server-backed models in src/app-config.json's
// llmList. These are ESTIMATES: public STANDARD list prices as of the date below —
// no negotiated rates, no batch discounts, and deliberately NO promotional or
// introductory rates (those expire and would silently understate cost). Update
// PRICES_AS_OF when editing rates.
// Rates are USD per 1M tokens. cacheReadPerM/cacheWritePerM price the
// input_token_details.cache_read / cache_creation portions; uncached input
// (input_tokens minus both) bills at inputPerM. Anthropic convention: read =
// 0.1x input, write = 1.25x input. The gpt-5.6 family also bills cache writes at
// 1.25x input, but LangChain's OpenAI converter surfaces only cache_read (never
// cache_creation), so written tokens land in the uncached bucket and the 0.25x
// write surcharge is invisible to this estimate; Gemini reports cache_creation 0.
// Not modeled: long-context tiers (gpt-5.6 bills the WHOLE request at 2x input /
// 1.5x output above 272K input tokens; gemini-3.1-pro has >200K tiers). DAVAI
// turns are far below those thresholds today.

export interface IUsage {
  input_tokens: number;
  output_tokens: number;
  input_token_details?: { cache_read?: number; cache_creation?: number };
}

export interface IModelCost { inputCost: number; outputCost: number; totalCost: number }

export const PRICES_AS_OF = "2026-08-24";

interface IModelRates { inputPerM: number; outputPerM: number; cacheReadPerM: number; cacheWritePerM: number }

const RATES: Record<string, IModelRates> = {
  // OpenAI. Sol's 4/20 promo (through at least 2026-11-21) is excluded per the
  // no-promo policy; OpenAI publishes no post-promo rate for it, so it uses the
  // prior-generation (gpt-5.5) list rate. 5.6-family cache writes = 1.25x input.
  "gpt-5.6-sol":   { inputPerM: 5,    outputPerM: 30,   cacheReadPerM: 0.50,  cacheWritePerM: 6.25 },
  "gpt-5.6-terra": { inputPerM: 2,    outputPerM: 12,   cacheReadPerM: 0.20,  cacheWritePerM: 2.50 },
  "gpt-5.6-luna":  { inputPerM: 0.20, outputPerM: 1.20, cacheReadPerM: 0.02,  cacheWritePerM: 0.25 },
  "gpt-5.5":       { inputPerM: 5,    outputPerM: 30,   cacheReadPerM: 0.50,  cacheWritePerM: 5 },
  "gpt-5.4-mini":  { inputPerM: 0.75, outputPerM: 4.50, cacheReadPerM: 0.075, cacheWritePerM: 0.75 },
  "gpt-5.4-nano":  { inputPerM: 0.20, outputPerM: 1.25, cacheReadPerM: 0.02,  cacheWritePerM: 0.20 },
  // Anthropic (read 0.1x, write 1.25x)
  "claude-opus-5":    { inputPerM: 5, outputPerM: 25, cacheReadPerM: 0.50, cacheWritePerM: 6.25 },
  "claude-sonnet-5":  { inputPerM: 3, outputPerM: 15, cacheReadPerM: 0.30, cacheWritePerM: 3.75 },
  "claude-haiku-4-5": { inputPerM: 1, outputPerM: 5,  cacheReadPerM: 0.10, cacheWritePerM: 1.25 },
  "claude-opus-4-8":  { inputPerM: 5, outputPerM: 25, cacheReadPerM: 0.50, cacheWritePerM: 6.25 },
  // Google. 3.7-flash uses the standard rate effective 2027-01-01 (the 0.75/3.75
  // introductory rate through 2026-12-31 is excluded per the no-promo policy).
  "gemini-3.7-flash":      { inputPerM: 1.50, outputPerM: 7.50, cacheReadPerM: 0.15, cacheWritePerM: 1.50 },
  "gemini-3.5-flash-lite": { inputPerM: 0.30, outputPerM: 2.50, cacheReadPerM: 0.03, cacheWritePerM: 0.30 },
  "gemini-3.5-flash":      { inputPerM: 1.50, outputPerM: 9,    cacheReadPerM: 0.15,  cacheWritePerM: 1.50 },
  "gemini-3.1-flash-lite": { inputPerM: 0.25, outputPerM: 1.50, cacheReadPerM: 0.025, cacheWritePerM: 0.25 },
  "gemini-3.1-pro-preview": { inputPerM: 2,   outputPerM: 12,   cacheReadPerM: 0.20,  cacheWritePerM: 2 },
};

export function costForUsage(modelId: string, usage: IUsage): IModelCost | undefined {
  const rates = RATES[modelId];
  if (!rates) return undefined;
  const cacheRead = usage.input_token_details?.cache_read ?? 0;
  const cacheWrite = usage.input_token_details?.cache_creation ?? 0;
  const uncached = Math.max(0, usage.input_tokens - cacheRead - cacheWrite);
  const inputCost = (uncached * rates.inputPerM + cacheRead * rates.cacheReadPerM +
    cacheWrite * rates.cacheWritePerM) / 1_000_000;
  const outputCost = (usage.output_tokens * rates.outputPerM) / 1_000_000;
  return { inputCost, outputCost, totalCost: inputCost + outputCost };
}
