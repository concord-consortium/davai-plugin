import { useContext } from "react";
import { AppConfigModelType } from "../models/app-config-model";
import { AppConfigContext } from "../contexts/app-config-context";

export const useAppConfigContext = (): AppConfigModelType => {
  const context = useContext(AppConfigContext);
  if (!context) {
    throw new Error("useAppConfigContext must be used within a AppConfigContext.Provider");
  }
  return context;
};
