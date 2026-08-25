import React from "react";
import { render, screen } from "@testing-library/react";
import { SessionCost } from "./session-cost";

// useRootStore is spied on via require() below (not jest.mock'd), so the real
// root-store-context module loads, which composes the real AssistantModel, which
// statically imports local-llm-service.ts, which imports this factory. It uses
// import.meta.url, which ts-jest's CJS transform cannot parse — mock it out the same
// way graph-sonification.test.tsx does (this file never exercises local-LLM behavior).
jest.mock("../utils/local-llm/local-llm-worker-factory", () => ({
  createLocalLlmWorker: jest.fn(() => ({} as Worker)),
}));

const renderWithSummary = (isDevMode: boolean, costSummary: any) => {
  jest.spyOn(require("../contexts/app-config-context"), "useAppConfigContext")
    .mockReturnValue({ isDevMode } as any);
  jest.spyOn(require("../contexts/root-store-context"), "useRootStore")
    .mockReturnValue({ assistantStore: { sessionCostSummary: costSummary } } as any);
  return render(<SessionCost />);
};

afterEach(() => jest.restoreAllMocks());

const summary = {
  asOf: "2026-08-24",
  models: [{ model: "claude-haiku-4-5", input: 21476, output: 13,
    cacheRead: 10586, cacheWrite: 10586,
    inputCost: 0.01455, outputCost: 0.000065, totalCost: 0.01461 }],
  totals: { input: 21476, output: 13, totalCost: 0.01461 },
};

it("renders totals and per-model tokens in dev mode", () => {
  renderWithSummary(true, summary);
  const el = screen.getByTestId("session-cost");
  expect(el.textContent).toContain("$0.0146");
  expect(el.textContent).toContain("21,476 in");
  expect(el.textContent).toContain("13 out");
  expect(el.getAttribute("aria-live")).toBeNull();
});

it("exposes the per-model breakdown via aria-label (screen-reader reachable), mirroring title", () => {
  renderWithSummary(true, summary);
  const el = screen.getByTestId("session-cost");
  const title = el.getAttribute("title");
  expect(title).toContain("claude-haiku-4-5");
  expect(el.getAttribute("aria-label")).toBe(title);
});

it("renders nothing outside dev mode", () => {
  renderWithSummary(false, summary);
  expect(screen.queryByTestId("session-cost")).not.toBeInTheDocument();
});

it("renders nothing before any usage is recorded", () => {
  renderWithSummary(true, { asOf: "2026-08-24", models: [], totals: { input: 0, output: 0 } });
  expect(screen.queryByTestId("session-cost")).not.toBeInTheDocument();
});
