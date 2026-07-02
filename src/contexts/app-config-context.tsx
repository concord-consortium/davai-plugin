import React, { createContext, useContext } from "react";
import { AppConfigModel, AppConfigModelSnapshot, AppConfigModelType } from "../models/app-config-model";
import { loadAndApplyMSTSettingOverrides, localStorageSettingsSource, urlParamSettingsSource } from "../utils/load-mst-settings";
import { addMSTSettingsSaver } from "../utils/save-mst-settings";
import { findEntryById, findEntryByLlmId, resolveEffort } from "../utils/llm-effort";

import appConfigJson from "../app-config.json";

export const AppConfigContext = createContext<AppConfigModelType | undefined>(undefined);

// Resolve ?model / ?effort URL params and validate effort against the (final) model.
// Applies via the config setters so the settings-saver persists the choice.
export function applyModelEffortFromUrl(appConfig: any, search: string) {
  const params = new URLSearchParams(search);
  const modelId = params.get("model");
  let modelSwitched = false;
  if (modelId) {
    const matched = findEntryById(appConfig.llmList, modelId);
    if (matched) {
      appConfig.setLlmId(JSON.stringify({ id: matched.id, provider: matched.provider }));
      modelSwitched = true;
    }
  }
  const entry = findEntryByLlmId(appConfig.llmList, appConfig.llmId);
  // When ?model switched the model, the stored effort belonged to the previous model, so
  // ignore it — effort resolves to ?effort (if valid) or the new model's default. Otherwise
  // (plain load) validate the restored effort against the current model.
  const current = modelSwitched ? "" : appConfig.effort;
  appConfig.setEffort(resolveEffort(entry, params.get("effort"), current));
}

const loadAppConfig = (): AppConfigModelType => {
  const defaultConfig = appConfigJson as AppConfigModelSnapshot;
  const appConfig = AppConfigModel.create(defaultConfig);
  loadAndApplyMSTSettingOverrides(appConfig, urlParamSettingsSource);
  loadAndApplyMSTSettingOverrides(appConfig, localStorageSettingsSource, "davai:");
  addMSTSettingsSaver(appConfig, localStorage, localStorageSettingsSource, "davai:", 1);
  applyModelEffortFromUrl(appConfig, window.location.search);
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

