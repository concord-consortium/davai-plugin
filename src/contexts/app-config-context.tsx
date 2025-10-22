import React, { createContext, useContext } from "react";
import { AppConfigModel, AppConfigModelSnapshot, AppConfigModelType } from "../models/app-config-model";
import { isAppMode } from "../types";

import appConfigJson from "../app-config.json";
import { getUrlParam } from "../utils/utils";

export const AppConfigContext = createContext<AppConfigModelType | undefined>(undefined);

const loadAppConfig = (): AppConfigModelSnapshot => {
  const defaultConfig = appConfigJson as AppConfigModelSnapshot;
  const urlParamMode = getUrlParam("mode");
  const llmId = getUrlParam("llmId");
  const configOverrides: Partial<AppConfigModelSnapshot> = {
    mode: isAppMode(urlParamMode) ? urlParamMode : defaultConfig.mode,
    llmId: llmId || defaultConfig.llmId,
  };

  return {
    ...defaultConfig,
    ...configOverrides,
  };
};

export const AppConfigProvider = ({ children }: { children: React.ReactNode }) => {
  const appConfigSnapshot = loadAppConfig();
  const appConfig = AppConfigModel.create(appConfigSnapshot);
  return (
    <AppConfigContext.Provider value={appConfig}>
      {children}
    </AppConfigContext.Provider>
  );
};

export const useAppConfigContext = (): AppConfigModelType => {
  const context = useContext(AppConfigContext);
  if (!context) {
    throw new Error("useAppConfigContext must be used within a AppConfigContext.Provider");
  }
  return context;
};

