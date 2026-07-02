import { findEntryById, findEntryByLlmId, resolveEffort, LlmEntry } from "./llm-effort";

const list: LlmEntry[] = [
  { id: "claude-sonnet-5", provider: "Anthropic", effortLevels: ["low","medium","high","xhigh","max"], defaultEffort: "high" },
  { id: "gpt-5.4-nano", provider: "OpenAI", effortLevels: ["none","low","medium","high","xhigh"], defaultEffort: "none" },
  { id: "claude-haiku-4-5", provider: "Anthropic", effortLevels: [] },
];

it("finds an entry by id and by llmId JSON", () => {
  expect(findEntryById(list, "gpt-5.4-nano")?.id).toBe("gpt-5.4-nano");
  expect(findEntryByLlmId(list, JSON.stringify({ id: "claude-sonnet-5", provider: "Anthropic" }))?.id).toBe("claude-sonnet-5");
  expect(findEntryByLlmId(list, "not json")).toBeUndefined();
});

it("keeps a requested effort that is valid for the model", () => {
  expect(resolveEffort(list[0], "low", "high")).toBe("low");
});

it("falls back to the current effort when requested is absent/invalid", () => {
  expect(resolveEffort(list[0], null, "medium")).toBe("medium");
  expect(resolveEffort(list[0], "none", "medium")).toBe("medium"); // none invalid for Anthropic
});

it("falls back to the model default when neither requested nor current is valid", () => {
  expect(resolveEffort(list[0], "none", "none")).toBe("high");
});

it("returns empty string for a no-effort model", () => {
  expect(resolveEffort(list[2], "low", "low")).toBe("");
  expect(resolveEffort(undefined, "low", "low")).toBe("");
});

it("returns empty string when defaultEffort is invalid or unset (config safety net)", () => {
  // "" means no effort is sent, so the provider applies its own default — safer than
  // forwarding a value the provider would reject.
  const badDefault: LlmEntry = { id: "x", provider: "P", effortLevels: ["low", "high"], defaultEffort: "typo" };
  expect(resolveEffort(badDefault, null, "")).toBe("");

  const noDefault: LlmEntry = { id: "y", provider: "P", effortLevels: ["low", "high"] };
  expect(resolveEffort(noDefault, null, "")).toBe("");
});
