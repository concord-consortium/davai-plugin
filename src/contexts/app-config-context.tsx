import React, { createContext, useContext } from "react";
import { AppConfigModel, AppConfigModelSnapshot, AppConfigModelType } from "../models/app-config-model";
import { loadAndApplyMSTSettingOverrides, localStorageSettingsSource, urlParamSettingsSource } from "../utils/load-mst-settings";
import { addMSTSettingsSaver } from "../utils/save-mst-settings";

import appConfigJson from "../app-config.json";

export const AppConfigContext = createContext<AppConfigModelType | undefined>(undefined);

const loadAppConfig = (): AppConfigModelType => {
  const defaultConfig = appConfigJson as AppConfigModelSnapshot;
  const appConfig = AppConfigModel.create(defaultConfig);
  loadAndApplyMSTSettingOverrides(appConfig, urlParamSettingsSource);
  loadAndApplyMSTSettingOverrides(appConfig, localStorageSettingsSource, "davai:");
  addMSTSettingsSaver(appConfig, localStorage, localStorageSettingsSource, "davai:", 1);
  return appConfig;
};

export const AppConfigProvider = ({ children }: { children: React.ReactNode }) => {
  const appConfig = loadAppConfig();
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

