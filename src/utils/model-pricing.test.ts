import { costForUsage, PRICES_AS_OF } from "./model-pricing";

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
    expect(cost.inputCost).toBeCloseTo(0.75, 6);
  });

  it("returns undefined for unknown models", () => {
    expect(costForUsage("mock", { input_tokens: 10, output_tokens: 1 })).toBeUndefined();
  });

  it("covers every server-backed llmList model", () => {
    const serverModels = ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna", "gpt-5.5",
      "gpt-5.4-mini", "gpt-5.4-nano", "claude-opus-5", "claude-haiku-4-5",
      "claude-sonnet-5", "claude-opus-4-8", "gemini-3.7-flash", "gemini-3.5-flash-lite",
      "gemini-3.5-flash", "gemini-3.1-flash-lite", "gemini-3.1-pro-preview"];
    for (const id of serverModels) {
      expect(costForUsage(id, { input_tokens: 1000, output_tokens: 100 })).toBeDefined();
    }
    expect(typeof PRICES_AS_OF).toBe("string");
  });
});
