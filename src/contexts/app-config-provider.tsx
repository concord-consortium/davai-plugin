import React from "react";
import { AppConfig, isAppMode } from "../types";
import appConfigJson from "../app-config.json";
import { AppConfigModel, AppConfigModelSnapshot } from "../models/app-config-model";
import { getUrlParam } from "../utils/utils";
import { AppConfigContext } from "./app-config-context";

export const loadAppConfig = (): AppConfig => {
  const defaultConfig = appConfigJson as AppConfig;
  const urlParamMode = getUrlParam("mode");
  const assistantId = getUrlParam("assistantId");
  const configOverrides: Partial<AppConfig> = {
    mode: isAppMode(urlParamMode) ? urlParamMode : defaultConfig.mode,
    assistantId: assistantId || defaultConfig.assistantId,
  };

  return {
    ...defaultConfig,
    ...configOverrides,
  };
};

export const AppConfigProvider = ({ children }: { children: React.ReactNode }) => {
  const appConfigSnapshot = loadAppConfig() as AppConfigModelSnapshot;
  const appConfig = AppConfigModel.create(appConfigSnapshot);
  return (
    <AppConfigContext.Provider value={appConfig}>
      {children}
    </AppConfigContext.Provider>
  );
};
