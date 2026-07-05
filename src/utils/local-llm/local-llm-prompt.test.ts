import { buildLocalSystemPrompt, buildTranscriptTurns, trimToBudget } from "./local-llm-prompt";
import { DAVAI_SPEAKER, USER_SPEAKER } from "../../constants";

it("builds the mirrored system prompt with contexts and /no_think", () => {
  const sys = buildLocalSystemPrompt({ ds: { collections: [] } }, [{ id: 1, name: "G1" }]);
  expect(sys).toContain("Role Description");
  expect(sys).toContain("### CODAP API documentation:");
  expect(sys).toContain("### Current CODAP Data Contexts:");
  expect(sys).toContain("\"ds\"");
  expect(sys).toContain("### Current CODAP Graphs:");
  expect(sys).toContain("\"G1\"");
  expect(sys.trimEnd().endsWith("/no_think")).toBe(true);
});

it("maps the last 6 transcript turns to chat roles", () => {
  const messages = Array.from({ length: 10 }, (_, i) => ({
    speaker: i % 2 === 0 ? USER_SPEAKER : DAVAI_SPEAKER,
    messageContent: { content: `m${i}` },
  }));
  const turns = buildTranscriptTurns(messages);
  expect(turns).toHaveLength(6);
  expect(turns[0]).toEqual({ role: "user", content: "m4" });
  expect(turns[5]).toEqual({ role: "assistant", content: "m9" });
});

it("drops oldest turns first, then truncates the system prompt, to fit the budget", () => {
  const sys = { role: "system" as const, content: "S".repeat(2000) };
  const turns = [
    { role: "user" as const, content: "A".repeat(1000) },
    { role: "assistant" as const, content: "B".repeat(1000) },
  ];
  const user = { role: "user" as const, content: "question" };
  const out = trimToBudget([sys, ...turns, user], 3000);
  expect(out[0].role).toBe("system");
  expect(out[out.length - 1]).toEqual(user);
  expect(out.find((m) => m.content.startsWith("A"))).toBeUndefined(); // oldest turn dropped first
  const total = out.reduce((n, m) => n + m.content.length, 0);
  expect(total).toBeLessThanOrEqual(3000);
  expect(out[0].content).toContain("[context truncated]");
});
