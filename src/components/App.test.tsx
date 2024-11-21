import React from "react";
import { App } from "./App";
import { render, screen } from "@testing-library/react";

describe("test load app", () => {
  it("renders without crashing", async () => {
    render(<App />);
    expect(screen.getByText("(Data Analysis through Voice and Artificial Intelligence)")).toBeDefined();
  });
});
