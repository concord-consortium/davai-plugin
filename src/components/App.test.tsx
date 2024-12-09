import React from "react";
import { render, screen } from "@testing-library/react";
import { App } from "./App";
import { AppConfigContext } from "../app-config-context";
import { AppConfigModel } from "../models/app-config-model";
import { mockAppConfig } from "../test-utils/mock-app-config";

jest.mock("../hooks/use-assistant-store", () => ({
  useAssistantStore: jest.fn(() => ({
    initialize: jest.fn(),
    transcriptStore: {
      messages: [],
      addMessage: jest.fn(),
    },
  })),
}));

jest.mock("../models/app-config-model", () => ({
  AppConfigModel: {
    create: jest.fn(() => (mockAppConfig)),
    initialize: jest.fn(),
  }
}));

const MockAppConfigProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const mockAppConfigValue = AppConfigModel.create(mockAppConfig);
  return (
    <AppConfigContext.Provider value={mockAppConfigValue}>
      {children}
    </AppConfigContext.Provider>
  );
};

describe("test load app", () => {
  it("renders without crashing", () => {
    render(
      <MockAppConfigProvider>
        <App />
      </MockAppConfigProvider>
    );
    expect(screen.getByText("Loading...")).toBeDefined();
  });
});
