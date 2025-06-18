import { useContext } from "react";
import { AppConfigContext } from "../contexts/app-config-context";
import { AppConfig } from "../types";

export const useAppConfig = () => {
  const context = useContext(AppConfigContext);
  if (!context) {
    throw new Error("useAppConfig must be used within an AppConfigProvider");
  }

  const { appConfig, setAppConfig, isAssistantMocked } = context;

  const setLlmId = (llmId: string) => {
    setAppConfig((prevConfig: AppConfig) => ({ ...prevConfig, llmId }));
  };

  return {
    appConfig,
    isAssistantMocked,
    setLlmId,
    // Destructured properties for easy access
    accessibility: appConfig.accessibility,
    llmId: appConfig.llmId,
    llmList: appConfig.llmList,
    dimensions: appConfig.dimensions,
    mode: appConfig.mode,
  };
};
