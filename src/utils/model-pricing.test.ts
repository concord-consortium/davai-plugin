import { costForUsage, PRICES_AS_OF } from "./model-pricing";
import appConfig from "../app-config.json";

describe("costForUsage", () => {
  it("prices uncached input, cached reads/writes, and output at their own rates", () => {
    // claude-haiku-4-5: in $1/M, out $5/M, cache read $0.10/M, cache write $1.25/M.
    // The live-verified turn-2 shape: total input 10744 of which 10586 cache_read.
    const cost = costForUsage("claude-haiku-4-5", {
      input_tokens: 10744,
      output_tokens: 8,
      input_token_details: { cache_read: 10586, cache_creation: 0 },
    })!;
    // uncached 158 @ $1/M + read 10586 @ $0.1/M = 0.000158 + 0.0010586
    expect(cost.inputCost).toBeCloseTo(0.0012166, 6);
    expect(cost.outputCost).toBeCloseTo(0.00004, 6);
    expect(cost.totalCost).toBeCloseTo(cost.inputCost + cost.outputCost, 10);
  });

  it("bills cache_creation at the write rate", () => {
    // Turn-1 shape from the live verification.
    const cost = costForUsage("claude-haiku-4-5", {
      input_tokens: 10732,
      output_tokens: 5,
      input_token_details: { cache_read: 0, cache_creation: 10586 },
    })!;
    // uncached 146 @ $1/M + write 10586 @ $1.25/M
    expect(cost.inputCost).toBeCloseTo(0.000146 + 0.0132325, 6);
  });

  it("handles absent cache details (all input at base rate)", () => {
    const cost = costForUsage("gemini-3.7-flash", { input_tokens: 1_000_000, output_tokens: 0 })!;
    expect(cost.inputCost).toBeCloseTo(1.50, 6);
  });

  it("uses standard (non-promotional) rates for models with active promos", () => {
    // Policy: no promotional/introductory rates in the table — they expire and
    // would silently understate cost. These pins fail if a promo rate sneaks in.
    // gemini-3.7-flash: standard 1.50/7.50 (intro 0.75/3.75 runs through 2026-12-31).
    const flash = costForUsage("gemini-3.7-flash", { input_tokens: 1_000_000, output_tokens: 1_000_000 })!;
    expect(flash.inputCost).toBeCloseTo(1.50, 6);
    expect(flash.outputCost).toBeCloseTo(7.50, 6);
    // gpt-5.6-sol: prior-generation list rate 5/30 (promo 4/20 through 2026-11-21).
    const sol = costForUsage("gpt-5.6-sol", { input_tokens: 1_000_000, output_tokens: 1_000_000 })!;
    expect(sol.inputCost).toBeCloseTo(5, 6);
    expect(sol.outputCost).toBeCloseTo(30, 6);
    // gemini-3.5-flash-lite: STANDARD 0.30/2.50, not the 0.15/1.25 batch rate.
    const lite = costForUsage("gemini-3.5-flash-lite", { input_tokens: 1_000_000, output_tokens: 1_000_000 })!;
    expect(lite.inputCost).toBeCloseTo(0.30, 6);
    expect(lite.outputCost).toBeCloseTo(2.50, 6);
  });

  it("bills gpt-5.6-family cache writes at 1.25x input", () => {
    // Latent today (LangChain's OpenAI converter never reports cache_creation),
    // but the rate must be right for when that field appears.
    const cost = costForUsage("gpt-5.6-terra", {
      input_tokens: 1_000_000, output_tokens: 0,
      input_token_details: { cache_read: 0, cache_creation: 1_000_000 },
    })!;
    expect(cost.inputCost).toBeCloseTo(2.50, 6);
  });

  it("returns undefined for unknown models", () => {
    expect(costForUsage("mock", { input_tokens: 10, output_tokens: 1 })).toBeUndefined();
  });

  it("covers every server-backed llmList model", () => {
    // Derived from app-config.json (not hardcoded) so adding a server-backed model
    // without a matching RATES entry fails this suite instead of silently pricing
    // as "n/a" in production.
    const serverModels = (appConfig.llmList as Array<{ id: string; provider: string }>)
      .filter((m) => m.provider !== "Mock" && m.provider !== "Local")
      .map((m) => m.id);
    expect(serverModels.length).toBeGreaterThan(0);
    for (const id of serverModels) {
      expect(costForUsage(id, { input_tokens: 1000, output_tokens: 100 })).toBeDefined();
    }
    expect(typeof PRICES_AS_OF).toBe("string");
  });
});
