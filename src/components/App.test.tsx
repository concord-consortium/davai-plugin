import React from "react";
import "openai/shims/node";
import { App } from "./App";
import { render, screen } from "@testing-library/react";

const mockOpenAi = jest.fn(
  async () => ({
    id: "assistant-id",
  })
);

jest.mock("../utils/llm-utils", () => ({
  initLlmConnection: () => ({
    beta: {
      assistants: {
        create: mockOpenAi
      },
      threads: {
        create: jest.fn()
      }
    }
  }),
  getTools: jest.fn()
}));

describe("test load app", () => {
  it("renders without crashing", () => {
    render(<App/>);
    expect(screen.getByText("Loading...")).toBeDefined();
  });
});
