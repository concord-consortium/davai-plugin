import React from "react";
import { AppConfigContext } from "../contexts/app-config-context";
import { mockAppConfig } from "./mock-app-config";

export const MockAppConfigProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const mockContextValue = {
    appConfig: mockAppConfig,
    setAppConfig: () => { /* no-op for testing */ },
    isAssistantMocked: true,
  };

  return (
    <AppConfigContext.Provider value={mockContextValue}>
      {children}
    </AppConfigContext.Provider>
  );
};
