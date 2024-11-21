import React from "react";
import { App } from "./App";
import { render, screen } from "@testing-library/react";

describe("test load app", () => {
  const mockHandleSetActiveTrap = jest.fn();
  it("renders without crashing", async () => {
    render(<App activeTrap={false} handleSetActiveTrap={mockHandleSetActiveTrap}/>);
    expect(screen.getByText("(Data Analysis through Voice and Artificial Intelligence)")).toBeDefined();
  });
});
