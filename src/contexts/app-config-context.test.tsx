import { applyModelEffortFromUrl } from "./app-config-context";

const makeConfig = () => ({
  llmList: [
    { id: "claude-sonnet-5", provider: "Anthropic", effortLevels: ["low","medium","high","xhigh","max"], defaultEffort: "high" },
    { id: "claude-haiku-4-5", provider: "Anthropic", effortLevels: [] },
  ],
  llmId: JSON.stringify({ id: "claude-haiku-4-5", provider: "Anthropic" }),
  effort: "max", // stale value invalid for haiku
  setLlmId(v: string) { this.llmId = v; },
  setEffort(v: string) { this.effort = v; },
});

it("?model resolves to the matching llmId and effort snaps to a valid value", () => {
  const c = makeConfig();
  applyModelEffortFromUrl(c as any, "?model=claude-sonnet-5&effort=low");
  expect(JSON.parse(c.llmId).id).toBe("claude-sonnet-5");
  expect(c.effort).toBe("low");
});

it("invalid ?effort for the URL model falls back to that model's default", () => {
  const c = makeConfig();
  applyModelEffortFromUrl(c as any, "?model=claude-sonnet-5&effort=none");
  expect(c.effort).toBe("high");
});

it("unknown ?model is ignored; effort validated against the existing model", () => {
  const c = makeConfig();
  applyModelEffortFromUrl(c as any, "?model=does-not-exist");
  expect(JSON.parse(c.llmId).id).toBe("claude-haiku-4-5"); // unchanged
  expect(c.effort).toBe(""); // haiku has no effort → stale "max" cleared
});

it("no url params still validates restored effort against restored model", () => {
  const c = makeConfig();
  c.llmId = JSON.stringify({ id: "claude-sonnet-5", provider: "Anthropic" });
  c.effort = "max"; // valid for sonnet-5
  applyModelEffortFromUrl(c as any, "");
  expect(c.effort).toBe("max");
});
