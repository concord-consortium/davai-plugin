import { createContext, useContext } from "react";
import { AppConfigModelType } from "./models/app-config-model";

export const AppConfigContext = createContext<AppConfigModelType | undefined>(undefined);

export const useAppConfigContext = (): AppConfigModelType => {
  const context = useContext(AppConfigContext);
  if (!context) {
    throw new Error("useAppConfig must be used within a AppConfigContext.Provider");
  }
  return context;
};
