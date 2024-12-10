import React from "react";
import { AppConfigContext } from "../app-config-context";
import { AppConfigModel } from "../models/app-config-model";
import { mockAppConfig } from "./mock-app-config";

export const MockAppConfigProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const mockAppConfigValue = AppConfigModel.create(mockAppConfig);
  return (
    <AppConfigContext.Provider value={mockAppConfigValue}>
      {children}
    </AppConfigContext.Provider>
  );
};
