import React from "react";
import { render, screen } from "@testing-library/react";
import { App } from "./App";

jest.mock("../models/assistant-model", () => ({
  assistantStore: {
    assistant: null,
    initialize: jest.fn(),
  },
}));

describe("test load app", () => {
  it("renders without crashing", () => {
    render(<App />);
    expect(screen.getByText("Loading...")).toBeDefined();
  });
});
