import React, { createContext, useEffect, useState, useMemo } from "react";
import { AppConfig, isAppMode } from "../types";
import { getUrlParam } from "../utils/utils";
import { defaultAppConfig } from "../constants";

interface IAppConfigContext {
  appConfig: AppConfig;
  setAppConfig: React.Dispatch<React.SetStateAction<AppConfig>>;
  isAssistantMocked: boolean;
}

export const AppConfigContext = createContext<IAppConfigContext>({
  appConfig: defaultAppConfig as AppConfig,
  setAppConfig: () => undefined,
  isAssistantMocked: false,
});

export const AppConfigProvider = ({ children }: { children: React.ReactNode }) => {
  const [appConfig, setAppConfig] = useState<AppConfig>(defaultAppConfig);

  useEffect(() => {
    const updates: Partial<AppConfig> = {};
    const urlMode = getUrlParam("mode");
    const llmId = getUrlParam("llmId");
    if (isAppMode(urlMode)) {
        updates.mode = urlMode;
    }
    if (llmId) {
      updates.llmId = llmId;
    }
    setAppConfig(prevConfig => ({
      ...prevConfig,
      updates
    }));
  }, []);

  const isAssistantMocked = useMemo(() => {
    try {
      const llmData = JSON.parse(appConfig.llmId || "");
      return llmData.id === "mock";
    } catch {
      return false;
    }
  }, [appConfig.llmId]);

  return (
    <AppConfigContext.Provider value={{appConfig, setAppConfig, isAssistantMocked}}>
      {children}
    </AppConfigContext.Provider>
  );
};
